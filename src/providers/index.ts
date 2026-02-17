import { AIProvider } from './base';
import { OpenAIProvider } from './openai-responses';
import { OpenAIChatProvider } from './openai-chat';
import { ProviderConfig, Env } from '../types';

export function createProvider(config: ProviderConfig, _env: Env): AIProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider(config.model, config.endpoint);

    case 'openaiChat':
      return new OpenAIChatProvider(config.model, config.endpoint ?? config.baseUrl);

    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

export type { AIProvider };
