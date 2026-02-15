import { RouteConfig, ProviderConfig, Env, OpenAIChatRequest, ProviderResponse } from './types';
import { TokenManager } from './token-manager';
import { ProxyError } from './utils/error-handler';

export class Router {
  private routes: RouteConfig;

  constructor(private env: Env) {
    this.routes = this.parseRoutesConfig();
  }

  /**
   * Get list of available models
   */
  getAvailableModels(): Array<{
    id: string;
    object: string;
    owned_by: string;
    permission: string[];
    description?: string;
    display_name?: string;
    context_length?: number;
    max_input_tokens?: number;
    max_output_tokens?: number;
    pricing?: {
      currency?: string;
      input_per_1m?: number;
      input_cache_per_1m?: number;
      output_per_1m?: number;
    };
    metadata?: Record<string, unknown>;
    flags?: string[];
  }> {
    return Object.entries(this.routes).map(([routeName, entry]) => {
      const provider = entry.providers[0];
      const pricing = provider
        ? {
            currency: provider.pricingCurrency,
            input_per_1m: provider.inputPricePer1m,
            input_cache_per_1m: provider.inputCachePricePer1m,
            output_per_1m: provider.outputPricePer1m,
          }
        : undefined;

      return {
        id: routeName,
        object: 'model',
        owned_by: 'ai-worker-proxy',
        permission: [],
        description: provider?.description,
        context_length: provider?.contextWindow ?? provider?.maxInputTokens,
        max_input_tokens: provider?.maxInputTokens,
        max_output_tokens: provider?.maxOutputTokens,
        pricing,
        metadata: entry.metadata,
        flags: entry.flags,
        display_name: entry.displayName ?? routeName,
      };
    });
  }

  /**
   * Get provider configurations for a given model name
   */
  getProvidersForModel(model: string): ProviderConfig[] {
    const normalizedModel = model.trim();

    // Check exact alias match first
    if (this.routes[normalizedModel]) {
      return this.routes[normalizedModel].providers;
    }

    // Check alias match ignoring case
    const caseInsensitiveAliasMatch = this.findRouteByAliasCaseInsensitive(normalizedModel);
    if (caseInsensitiveAliasMatch) {
      const [routeName, providers] = caseInsensitiveAliasMatch;
      console.log(
        `[Router] Model "${model}" matched route alias "${routeName}" by case-insensitive lookup`
      );
      return providers;
    }

    // Check direct provider model match (e.g. request model = provider.model)
    const providerModelMatch = this.findRouteByProviderModel(normalizedModel);
    if (providerModelMatch) {
      const [routeName, providers] = providerModelMatch;
      console.log(`[Router] Model "${model}" matched provider model under route "${routeName}"`);
      return providers;
    }

    // Optional explicit default route
    const explicitDefaultRoute = this.routes.default ?? this.routes._default;
    if (explicitDefaultRoute) {
      console.log(
        `[Router] No configuration found for model "${model}", using explicit default route`
      );
      return explicitDefaultRoute.providers;
    }

    throw new ProxyError(
      `The model \`${model}\` does not exist or you do not have access to it.`,
      404,
      'model_not_found',
      'model'
    );
  }

  /**
   * Execute request with provider fallback
   * Will try providers in order until one succeeds
   */
  async executeWithFallback(request: OpenAIChatRequest): Promise<ProviderResponse> {
    const model = request.model;
    if (!model) {
      throw new ProxyError('Model name is required', 400);
    }

    const providers = this.getProvidersForModel(model);

    console.log(`[Router] Model "${model}" has ${providers.length} provider(s) configured`);

    let lastError: any = null;

    // Try each provider in order
    for (let i = 0; i < providers.length; i++) {
      const config = providers[i];
      console.log(
        `[Router] Trying provider ${i + 1}/${providers.length}: ${config.provider}/${config.model}`
      );

      try {
        const manager = new TokenManager(config, this.env);
        const response = await manager.executeWithRotation(request);

        if (response.success) {
          console.log(`[Router] Success with provider: ${config.provider}/${config.model}`);
          return response;
        }

        lastError = response.error;
        console.log(
          `[Router] Provider ${config.provider}/${config.model} failed: ${response.error}`
        );
      } catch (error) {
        lastError = error;
        console.error(`[Router] Provider ${config.provider}/${config.model} exception:`, error);
      }
    }

    // All providers failed
    return {
      success: false,
      error: `All providers failed. Last error: ${lastError?.message || lastError || 'Unknown error'}`,
      statusCode: 500,
    };
  }

  private parseRoutesConfig(): RouteConfig {
    try {
      const configStr = this.env.ROUTES_CONFIG;
      if (!configStr) {
        throw new Error('ROUTES_CONFIG not found in environment');
      }

      const config = JSON.parse(configStr) as RouteConfig;
      console.log('[Router] Loaded routes:', Object.keys(config));
      return config;
    } catch (error) {
      console.error('[Router] Failed to parse ROUTES_CONFIG:', error);
      throw new ProxyError('Invalid ROUTES_CONFIG', 500);
    }
  }

  private findRouteByAliasCaseInsensitive(model: string): [string, ProviderConfig[]] | null {
    const target = model.toLowerCase();
    for (const [routeName, entry] of Object.entries(this.routes)) {
      if (routeName.toLowerCase() === target) {
        return [routeName, entry.providers];
      }
    }
    return null;
  }

  private findRouteByProviderModel(model: string): [string, ProviderConfig[]] | null {
    const target = model.toLowerCase();
    for (const [routeName, entry] of Object.entries(this.routes)) {
      const matched = entry.providers.some((provider) => provider.model.toLowerCase() === target);
      if (matched) {
        return [routeName, entry.providers];
      }
    }
    return null;
  }
}
