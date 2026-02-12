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

export interface ProxyInputItem {
  type?: 'message';
  role: 'system' | 'user' | 'assistant' | 'developer' | 'tool' | 'function';
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
  tool_choice?: ToolChoice;
  previous_response_id?: string;
  max_tool_calls?: number;
  store?: boolean;
}

export interface ProxyResponseContentPart {
  type: 'output_text' | 'refusal' | string;
  text?: string;
  refusal?: string;
  annotations?: unknown[];
}

export interface ProxyResponseOutputItem {
  id?: string;
  type: 'message' | 'function_call' | 'reasoning' | string;
  status?: 'completed' | 'in_progress' | 'incomplete' | 'failed' | string;
  role?: 'assistant' | 'user' | 'system';
  content?: ProxyResponseContentPart[];
  callId?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
}

export interface ProxyResponseUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details?: unknown;
  output_tokens_details?: unknown;
}

export interface ProxyResponse {
  id: string;
  object?: 'response' | string;
  created_at?: number;
  completed_at?: number;
  status?: 'completed' | 'in_progress' | 'incomplete' | 'failed' | string;
  model?: string;
  output: ProxyResponseOutputItem[];
  usage?: ProxyResponseUsage;
  metadata?: Record<string, unknown> | null;
  instructions?: string | null;
  previous_response_id?: string | null;
  parallel_tool_calls?: boolean;
  temperature?: number | null;
  top_p?: number | null;
  tool_choice?: unknown;
  tools?: unknown[];
  truncation?: string | null;
  text?: unknown;
  store?: boolean;
  service_tier?: string | null;
}

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
