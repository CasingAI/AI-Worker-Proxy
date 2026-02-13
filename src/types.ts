import type { Response as OpenAIResponse } from 'openai/resources/responses/responses';

// OpenAI-style message helpers kept for provider adapters
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
  function?: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
  name?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

export type ToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } }
  | { type: 'function'; name: string };

export type ProxyInputRole = 'system' | 'user' | 'assistant' | 'developer' | 'tool' | 'function';

export interface ProxyMessageInputItem {
  type?: 'message';
  role: ProxyInputRole;
  content: string | Array<Record<string, unknown>>;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ProxyFunctionCallOutputInputItem {
  type: 'function_call_output';
  call_id?: string;
  callId?: string;
  output?: unknown;
  content?: unknown;
}

export interface ProxyFunctionCallInputItem {
  type: 'function_call';
  id?: string;
  call_id?: string;
  callId?: string;
  name?: string;
  arguments?: string | Record<string, unknown>;
}

export type ProxyInputItem =
  | ProxyMessageInputItem
  | ProxyFunctionCallOutputInputItem
  | ProxyFunctionCallInputItem
  | Record<string, unknown>;

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
  tool_choice?: ToolChoice;
  previous_response_id?: string;
  max_tool_calls?: number;
  store?: boolean;
}

type OpenAIResponseOutputItem = OpenAIResponse['output'][number];
type OpenAIMessageOutputItem = Extract<OpenAIResponseOutputItem, { type: 'message' }>;

export type ProxyResponseContentPart =
  OpenAIMessageOutputItem extends { content?: Array<infer Part> } ? Part : never;

export type ProxyResponseOutputItem = OpenAIResponseOutputItem;

export type ProxyResponseUsage = NonNullable<OpenAIResponse['usage']>;

export type ProxyResponse = OpenAIResponse;

// Provider configuration
export interface ProviderConfig {
  provider: 'openai' | 'zhipu';
  model: string;
  apiKeys: string[]; // Array of env var names
  baseUrl?: string; // Optional custom base URL (primarily for zhipu)
}

export interface RouteConfig {
  [route: string]: ProviderConfig[];
}

// Environment bindings
export interface Env {
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
