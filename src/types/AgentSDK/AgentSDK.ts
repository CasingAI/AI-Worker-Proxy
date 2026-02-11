/**
 * 服务器侧 Responses API（标准接口）事件定义。
 * 注意：这是服务端原始 SSE 事件，不是 SDK 内部转换后的事件名。
 */

export interface ResponseUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details?: Record<string, number>;
  output_tokens_details?: Record<string, number>;
}

export interface ResponseContentPart {
  type: 'output_text' | 'refusal' | string;
  text?: string;
  refusal?: string;
  annotations?: unknown[];
  [key: string]: unknown;
}

export interface ResponseOutputItem {
  id: string;
  type: 'message' | 'function_call' | 'reasoning' | string;
  role?: 'assistant' | 'user' | 'system';
  status?: 'in_progress' | 'completed' | 'incomplete' | 'failed';
  content?: ResponseContentPart[];
  [key: string]: unknown;
}

export interface ResponseObject {
  id: string;
  object: 'response';
  created_at: number;
  completed_at?: number;
  status: 'in_progress' | 'completed' | 'incomplete' | 'failed';
  model: string;
  output: ResponseOutputItem[];
  usage?: ResponseUsage;
  metadata?: Record<string, unknown> | null;
  instructions?: string | null;
  previous_response_id?: string | null;
  [key: string]: unknown;
}

export interface ResponseCreatedEvent {
  type: 'response.created';
  response: ResponseObject;
}

export interface ResponseOutputItemAddedEvent {
  type: 'response.output_item.added';
  output_index: number;
  item: ResponseOutputItem;
}

export interface ResponseOutputTextDeltaEvent {
  type: 'response.output_text.delta';
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string;
}

export interface ResponseOutputTextDoneEvent {
  type: 'response.output_text.done';
  item_id: string;
  output_index: number;
  content_index: number;
  text: string;
}

export interface ResponseOutputItemDoneEvent {
  type: 'response.output_item.done';
  output_index: number;
  item: ResponseOutputItem;
}

export interface ResponseCompletedEvent {
  type: 'response.completed';
  response: ResponseObject;
}

export interface ResponseFailedEvent {
  type: 'response.failed';
  response: ResponseObject;
}

export interface ProviderRawEvent {
  type: 'provider_raw_event';
  provider: string;
  event: unknown;
}

export type ResponseStreamEvent =
  | ResponseCreatedEvent
  | ResponseOutputItemAddedEvent
  | ResponseOutputTextDeltaEvent
  | ResponseOutputTextDoneEvent
  | ResponseOutputItemDoneEvent
  | ResponseCompletedEvent
  | ResponseFailedEvent
  | ProviderRawEvent
  | { type: string; [key: string]: unknown };
