import { RouteConfig, RouteEntry, ProviderConfig, Env, OpenAIChatRequest, ProviderResponse } from './types';
import { TokenManager } from './token-manager';
import { ProxyError } from './utils/error-handler';

type RouteResolution = {
  routeName: string;
  entry: RouteEntry;
  providers: ProviderConfig[];
};

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
      const pricingCurrency = entry.pricingCurrency ?? provider?.pricingCurrency;
      const inputPricePer1m = entry.inputPricePer1m ?? provider?.inputPricePer1m;
      const inputCachePricePer1m = entry.inputCachePricePer1m ?? provider?.inputCachePricePer1m;
      const outputPricePer1m = entry.outputPricePer1m ?? provider?.outputPricePer1m;
      const pricing =
        pricingCurrency || inputPricePer1m || inputCachePricePer1m || outputPricePer1m
          ? {
              currency: pricingCurrency,
              input_per_1m: inputPricePer1m,
              input_cache_per_1m: inputCachePricePer1m,
              output_per_1m: outputPricePer1m,
            }
          : undefined;
      const contextLength =
        entry.contextWindow ??
        entry.maxInputTokens ??
        provider?.contextWindow ??
        provider?.maxInputTokens;
      const maxInputTokens = entry.maxInputTokens ?? provider?.maxInputTokens;
      const maxOutputTokens = entry.maxOutputTokens ?? provider?.maxOutputTokens;
      const description = entry.description ?? provider?.description;

      return {
        id: routeName,
        object: 'model',
        owned_by: 'ai-worker-proxy',
        permission: [],
        description,
        context_length: contextLength,
        max_input_tokens: maxInputTokens,
        max_output_tokens: maxOutputTokens,
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
  getProvidersForModel(model: string): RouteResolution {
    const normalizedModel = model.trim();

    if (this.routes[normalizedModel]) {
      return {
        routeName: normalizedModel,
        entry: this.routes[normalizedModel],
        providers: this.routes[normalizedModel].providers,
      };
    }

    const aliasMatch = this.findRouteEntryByAliasCaseInsensitive(model);
    if (aliasMatch) {
      const [routeName, entry] = aliasMatch;
      return {
        routeName,
        entry,
        providers: entry.providers,
      };
    }

    const providerMatch = this.findRouteEntryByProviderModel(model);
    if (providerMatch) {
      const [routeName, entry] = providerMatch;
      return {
        routeName,
        entry,
        providers: entry.providers,
      };
    }

    const defaultRouteName = this.routes.default
      ? 'default'
      : this.routes._default
      ? '_default'
      : undefined;
    if (defaultRouteName) {
      const entry = this.routes[defaultRouteName];
      console.log(
        `[Router] No configuration found for model "${model}", using explicit default route "${defaultRouteName}"`
      );
      return {
        routeName: defaultRouteName,
        entry,
        providers: entry.providers,
      };
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

    const routeResolution = this.getProvidersForModel(model);
    const providers = routeResolution.providers;
    const routeReasoningEffort = routeResolution.entry.metadata?.reasoning_effort;

    console.log(`[Router] Model "${model}" has ${providers.length} provider(s) configured`);
    console.log(
      `[Router] Route "${routeResolution.routeName}" reasoning_effort="${routeReasoningEffort ?? 'default'}"`
    );

    let lastError: any = null;

    // Try each provider in order
    for (let i = 0; i < providers.length; i++) {
      const config = providers[i];
      console.log(
        `[Router] Trying provider ${i + 1}/${providers.length}: ${config.provider}/${config.model}`
      );

      try {
        const manager = new TokenManager(config, this.env);
        const response = await manager.executeWithRotation(request, routeReasoningEffort);

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

  private findRouteEntryByAliasCaseInsensitive(model: string): [string, RouteEntry] | null {
    const target = model.toLowerCase();
    for (const [routeName, entry] of Object.entries(this.routes)) {
      if (routeName.toLowerCase() === target) {
        console.log(
          `[Router] Model "${model}" matched route alias "${routeName}" by case-insensitive lookup`
        );
        return [routeName, entry];
      }
    }
    return null;
  }

  private findRouteEntryByProviderModel(model: string): [string, RouteEntry] | null {
    const target = model.toLowerCase();
    for (const [routeName, entry] of Object.entries(this.routes)) {
      const matched = entry.providers.some((provider) => provider.model.toLowerCase() === target);
      if (matched) {
        console.log(`[Router] Model "${model}" matched provider model under route "${routeName}"`);
        return [routeName, entry];
      }
    }
    return null;
  }
}
