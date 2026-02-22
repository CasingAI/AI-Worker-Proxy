import { OpenAIChatRequest, ProviderResponse, RouteConfigOptions } from '../types';

export interface AIProvider {
  /**
   * Send a chat completion request
   * @param request OpenAI-format request
   * @param apiKey API key to use
   * @param routeConfig 路由 config（enableThinking、prompt），覆盖请求体
   */
  chat(request: OpenAIChatRequest, apiKey: string, routeConfig?: RouteConfigOptions): Promise<ProviderResponse>;
}

export abstract class BaseProvider implements AIProvider {
  constructor(
    protected model: string,
    protected endpoint?: string
  ) {}

  abstract chat(
    request: OpenAIChatRequest,
    apiKey: string,
    routeConfig?: RouteConfigOptions
  ): Promise<ProviderResponse>;

  protected handleError(error: any, context: string): ProviderResponse {
    console.error(`[${context}] Error:`, error);

    let statusCode = 500;
    const message = error?.message || 'Unknown error';

    if (error?.status) {
      statusCode = error.status;
    } else if (error?.statusCode) {
      statusCode = error.statusCode;
    }

    return {
      success: false,
      error: message,
      statusCode,
    };
  }
}
