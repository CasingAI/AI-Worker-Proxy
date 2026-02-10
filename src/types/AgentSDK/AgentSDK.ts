/**
 * https://github.com/openai/agents-core/blob/main/src/types/protocol.ts
 * 统一 SDK 中 RunStreamEvent/ResponseStreamEvent 的 TypeScript 描述，方便代理解析 SSE payload。
 */

export type ProviderData = Record<string, unknown>;

export interface ResponseStreamEventBase {
  providerData?: ProviderData;
}

export interface ResponseStartedEvent extends ResponseStreamEventBase {
  type: 'response_started';
}

export interface OutputTextDeltaEvent extends ResponseStreamEventBase {
  type: 'output_text_delta';
  delta: string;
  itemId?: string;
  outputIndex?: number;
  contentIndex?: number;
}

export interface ResponseDoneEvent extends ResponseStreamEventBase {
  type: 'response_done';
  response: ResponseObject;
}

export interface RawModelEvent extends ResponseStreamEventBase {
  type: 'model';
  event: ResponseStreamEvent;
}

export type ResponseStreamEvent =
  | ResponseStartedEvent
  | OutputTextDeltaEvent
  | ResponseDoneEvent
  | RawModelEvent;

export interface ResponseObject {
  id: string;
  object?: string;
  status?: 'completed' | 'in_progress' | 'failed' | 'incomplete';
  model?: string;
  created_at?: number;
  completed_at?: number;
  instructions?: string | null;
  previous_response_id?: string | null;
  output?: ResponseOutputItem[];
  usage?: ResponseUsage;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ResponseOutputItem {
  id: string;
  type: 'message' | 'tool' | 'reasoning' | string;
  role: 'assistant' | string;
  status?: 'completed' | 'in_progress' | 'incomplete';
  content?: ResponseContentBlock[];
  [key: string]: unknown;
}

export type ResponseContentBlock =
  | OutputTextBlock
  | ReasoningTextBlock
  | RefusalBlock
  | ToolCallBlock
  | { type: string; [key: string]: unknown };

export interface OutputTextBlock {
  type: 'output_text';
  text: string;
  annotations?: unknown[];
}

export interface ReasoningTextBlock {
  type: 'reasoning_text';
  text: string;
}

export interface RefusalBlock {
  type: 'refusal';
  refusal: string;
}

export interface ToolCallBlock {
  type: 'input_text' | 'input_image' | 'file' | 'image';
  [key: string]: unknown;
}

export interface ResponseUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details?: Record<string, number>;
  output_tokens_details?: Record<string, number>;
}

export class RunRawModelStreamEvent {
  readonly type = 'raw_model_stream_event';
  constructor(public readonly data: ResponseStreamEvent) {}
}

export type RunItemStreamEventName =
  | 'message_output_created'
  | 'handoff_requested'
  | 'handoff_occurred'
  | 'tool_called'
  | 'tool_output'
  | 'reasoning_item_created'
  | 'tool_approval_requested';

export interface AgentRunItem {
  id: string;
  type: string;
  [key: string]: unknown;
}

export class RunItemStreamEvent {
  readonly type = 'run_item_stream_event';
  constructor(public readonly name: RunItemStreamEventName, public readonly item: AgentRunItem) {}
}

export class RunAgentUpdatedStreamEvent {
  readonly type = 'agent_updated_stream_event';
  constructor(public readonly agent: Record<string, unknown>) {}
}

export type RunStreamEvent =
  | RunRawModelStreamEvent
  | RunItemStreamEvent
  | RunAgentUpdatedStreamEvent;
