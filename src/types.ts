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

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

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
  /** 由代理从 ROUTES_CONFIG 注入，合并进 Chat Completions 请求体（如智谱 tool_stream） */
  customParams?: Record<string, unknown>;
}

type OpenAIResponseOutputItem = OpenAIResponse['output'][number];
type OpenAIMessageOutputItem = Extract<OpenAIResponseOutputItem, { type: 'message' }>;

export type ProxyResponseContentPart =
  OpenAIMessageOutputItem extends { content?: Array<infer Part> } ? Part : never;

export type ProxyResponseOutputItem = OpenAIResponseOutputItem;

export type ProxyResponseUsage = NonNullable<OpenAIResponse['usage']>;

export type ProxyResponse = OpenAIResponse;

// Provider configuration
// openai = OpenAI Responses API; openaiChat = OpenAI-format Chat Completions (e.g. 智谱)
export interface ProviderConfig {
  provider: 'openai' | 'openaiChat';
  model: string;
  apiKeys: string[]; // Array of env var names
  endpoint?: string; // Custom base URL (e.g. for openaiChat: 智谱 endpoint)
  baseUrl?: string; // Legacy custom base URL (kept for older configs)
  contextWindow?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  description?: string;
  metadata?: Record<string, unknown>;
  pricingCurrency?: string;
  inputPricePer1m?: number;
  inputCachePricePer1m?: number;
  outputPricePer1m?: number;
  /** 合并进该 provider 的 API 请求体（如 openaiChat 的 tool_stream: true） */
  customParams?: Record<string, unknown>;
}

export interface RouteMetadata {
  reasoning_effort?: ReasoningEffort;
  [key: string]: unknown;
}

/** 路由内部行为配置。思考等供应商参数用 provider.customParams。 */
export interface RouteConfigOptions {
  /** 自定义 prompt，注入到 system/instructions */
  prompt?: string;
}

export interface RouteEntry {
  providers: ProviderConfig[];
  metadata?: RouteMetadata;
  config?: RouteConfigOptions;
  flags?: string[];
  displayName?: string;
  description?: string;
  contextWindow?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  pricingCurrency?: string;
  inputPricePer1m?: number;
  inputCachePricePer1m?: number;
  outputPricePer1m?: number;
}

export interface RouteConfig {
  [route: string]: RouteEntry;
}

// Environment bindings
export interface Env {
  PROXY_AUTH_TOKEN: string; // Cloudflare Secret (set in Dashboard)
  ROUTES_CONFIG: string; // Environment variable (injected from GitHub Variable)
  /** JSON 数组字符串，仅允许 relay 到这些 host，如 ["api.openai.com","api.anthropic.com"] */
  RELAY_ALLOWED_HOSTS?: string;
  /** JSON 数组字符串，Jina 工具使用的 API Key 的 env 变量名，支持多 key 轮换，如 ["JINA_KEY_1","JINA_KEY_2"] */
  JINA_API_KEYS?: string;
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
