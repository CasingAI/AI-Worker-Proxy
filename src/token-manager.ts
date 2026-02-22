import { ProviderConfig, Env, OpenAIChatRequest, ProviderResponse, RouteConfigOptions } from './types';
import { createProvider } from './providers';
import { isRetryableError, isRateLimitError } from './utils/error-handler';

export class TokenManager {
  constructor(
    private config: ProviderConfig,
    private env: Env
  ) {}

  /**
   * Try to execute request with token rotation
   * Will try all tokens in order until one succeeds
   */
  async executeWithRotation(
    request: OpenAIChatRequest,
    routeConfig?: RouteConfigOptions
  ): Promise<ProviderResponse> {
    const provider = createProvider(this.config, this.env);
    const apiKeys = this.getApiKeys();
    const configuredApiKeys = Array.isArray(this.config.apiKeys) ? this.config.apiKeys : [];

    if (apiKeys.length === 0) {
      if (configuredApiKeys.length > 0) {
        const missingEnvVars = configuredApiKeys.join(', ');
        const errorMessage = `No API keys available for ${this.config.provider}/${this.config.model}. Missing env vars: ${missingEnvVars}`;
        console.error(`[TokenManager] ${errorMessage}`);
        return {
          success: false,
          error: errorMessage,
          statusCode: 500,
        };
      }

      // For providers that don't need API keys
      return await provider.chat(request, '', routeConfig);
    }

    let lastError: any = null;
    let lastStatusCode: number | undefined;

    // Try each API key in order
    for (const apiKey of apiKeys) {
      try {
        console.log(
          `[TokenManager] Trying ${this.config.provider}/${this.config.model} with key ending in ...${apiKey.slice(-4)}`
        );

        const response = await provider.chat(request, apiKey, routeConfig);

        if (response.success) {
          console.log(`[TokenManager] Success with key ending in ...${apiKey.slice(-4)}`);
          return response;
        }

        // If response failed but it's retryable, try next key
        lastError = response.error;
        lastStatusCode = response.statusCode;
        console.log(
          `[TokenManager] Failed with key ending in ...${apiKey.slice(-4)}: ${response.error}`
        );

        // If it's not a retryable error, don't try other keys for this provider
        if (response.statusCode && !this.isRetryableStatusCode(response.statusCode)) {
          break;
        }
      } catch (error) {
        lastError = error;
        lastStatusCode =
          (error as any)?.statusCode ??
          (error as any)?.status ??
          (isRateLimitError(error) ? 429 : undefined);
        console.error(`[TokenManager] Exception with key ending in ...${apiKey.slice(-4)}:`, error);

        // If it's a retryable error, continue to next key
        if (!isRetryableError(error)) {
          break;
        }
      }
    }

    // All keys failed：透传上游状态码（如 429），避免 429 被错误地变成 500
    return {
      success: false,
      error: lastError?.message || lastError || 'All API keys failed',
      statusCode: lastStatusCode ?? 500,
    };
  }

  private getApiKeys(): string[] {
    const keys: string[] = [];

    for (const keyName of this.config.apiKeys) {
      const keyValue = this.env[keyName];
      if (keyValue) {
        keys.push(keyValue);
      } else {
        console.warn(`[TokenManager] API key not found in env: ${keyName}`);
      }
    }

    return keys;
  }

  private isRetryableStatusCode(statusCode: number): boolean {
    return statusCode === 429 || statusCode === 503 || statusCode === 502;
  }
}
