import type { Response as OpenAIResponse, ResponseStreamEvent as OpenAIResponseStreamEvent } from 'openai/resources/responses/responses';

/**
 * 基于 OpenAI 官方 Responses 类型导出的服务端 SSE 事件类型。
 * 说明：保持当前导出名不变，便于项目内外继续按既有命名使用。
 */

type OpenAIResponseOutputItem = OpenAIResponse['output'][number];

type OpenAIMessageOutputItem = Extract<OpenAIResponseOutputItem, { type: 'message' }>;

export type ResponseUsage = NonNullable<OpenAIResponse['usage']>;

export type ResponseContentPart =
  OpenAIMessageOutputItem extends { content?: Array<infer Part> } ? Part : never;

export type ResponseOutputItem = OpenAIResponseOutputItem;

export type ResponseObject = OpenAIResponse;

export type ResponseCreatedEvent = Extract<OpenAIResponseStreamEvent, { type: 'response.created' }>;

export type ResponseOutputItemAddedEvent = Extract<
  OpenAIResponseStreamEvent,
  { type: 'response.output_item.added' }
>;

export type ResponseOutputTextDeltaEvent = Extract<
  OpenAIResponseStreamEvent,
  { type: 'response.output_text.delta' }
>;

export type ResponseOutputTextDoneEvent = Extract<
  OpenAIResponseStreamEvent,
  { type: 'response.output_text.done' }
>;

export type ResponseFunctionCallArgumentsDeltaEvent = Extract<
  OpenAIResponseStreamEvent,
  { type: 'response.function_call_arguments.delta' }
>;

export type ResponseFunctionCallArgumentsDoneEvent = Extract<
  OpenAIResponseStreamEvent,
  { type: 'response.function_call_arguments.done' }
>;

export type ResponseOutputItemDoneEvent = Extract<
  OpenAIResponseStreamEvent,
  { type: 'response.output_item.done' }
>;

export type ResponseCompletedEvent = Extract<OpenAIResponseStreamEvent, { type: 'response.completed' }>;

export type ResponseFailedEvent = Extract<OpenAIResponseStreamEvent, { type: 'response.failed' }>;

export type ResponseStreamEvent = OpenAIResponseStreamEvent;
