import { AIProvider } from './base';
import { OpenAIProvider } from './openai';
import { ZhipuProvider } from './zhipu';
import { ProviderConfig, Env } from '../types';

export function createProvider(config: ProviderConfig, _env: Env): AIProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider(config.model);

    case 'zhipu':
      return new ZhipuProvider(config.model, config.baseUrl);

    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

export type { AIProvider };
