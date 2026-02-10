// OpenAI-style message helpers kept for provider adapters
import type { ResponseObject } from './types/AgentSDK/AgentSDK';
export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'function' | 'developer';
  content: string | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ProxyInputItem {
  type?: 'message';
  role: 'system' | 'user' | 'assistant' | 'developer';
  content: string;
}

export interface OpenAIChatRequest {
  model: string;
  messages?: OpenAIMessage[];
  input?: string | ProxyInputItem[];
  instructions?: string;
  temperature?: number;
  max_tokens?: number;
  max_output_tokens?: number;
  top_p?: number;
  stop?: string | string[];
  stream?: boolean;
  tools?: Tool[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  previous_response_id?: string;
  max_tool_calls?: number;
  store?: boolean;
}

export type ProxyResponse = ResponseObject;

// Provider configuration
export interface ProviderConfig {
  provider:
    | 'anthropic'
    | 'google'
    | 'openai'
    | 'openai-compatible'
    | 'cloudflare-ai'
    | 'zhipu';
  model: string;
  apiKeys: string[]; // Array of env var names
  baseUrl?: string; // For openai-compatible providers
}

export interface RouteConfig {
  [route: string]: ProviderConfig[];
}

// Environment bindings
export interface Env {
  AI?: any; // Cloudflare AI binding
  PROXY_AUTH_TOKEN: string; // Cloudflare Secret (set in Dashboard)
  ROUTES_CONFIG: string; // Environment variable (injected from GitHub Variable)
  [key: string]: any; // Dynamic API keys (Cloudflare Secrets, set in Dashboard)
}

// Provider response
export interface ProviderResponse {
  success: boolean;
  response?: ProxyResponse;
  stream?: ReadableStream<Uint8Array>;
  error?: string;
  statusCode?: number;
}
