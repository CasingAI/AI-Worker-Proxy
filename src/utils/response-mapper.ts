import type { ProxyResponse, ProxyResponseOutputItem, ProxyResponseUsage } from '../types';

export function createProxyResponse(
  content: string,
  model: string,
  options?: {
    responseId?: string;
    itemId?: string;
    status?: 'completed' | 'in_progress' | 'incomplete';
    createdAt?: number;
    usage?: ProxyResponseUsage;
    /** 与 OpenAI Responses API 对齐：有 reasoning 时写入 message content 并参与 usage */
    reasoningSummary?: string;
  }
): ProxyResponse {
  const responseId = options?.responseId ?? `resp-${generateId()}`;
  const itemId = options?.itemId ?? `item-${generateId()}`;
  const now = options?.createdAt ?? Math.floor(Date.now() / 1000);
  const usage: ProxyResponseUsage =
    options?.usage ??
    {
      input_tokens: 0,
      output_tokens: Math.max(content.length, 0),
      total_tokens: Math.max(content.length, 0),
      input_tokens_details: {
        cached_tokens: 0,
      },
      output_tokens_details: {
        reasoning_tokens: 0,
      },
    };

  const contentParts: Array<{ type: string; text?: string; annotations?: unknown[]; summary?: string }> = [];
  if (options?.reasoningSummary) {
    contentParts.push({ type: 'reasoning', summary: options.reasoningSummary });
  }
  contentParts.push({
    type: 'output_text',
    text: content,
    annotations: [],
  });

  const outputItem: ProxyResponseOutputItem = {
    id: itemId,
    type: 'message',
    role: 'assistant',
    status: options?.status ?? 'completed',
    content: contentParts,
  } as ProxyResponseOutputItem;

  return {
    id: responseId,
    object: 'response',
    created_at: now,
    output_text: content,
    error: null,
    incomplete_details: null,
    status: options?.status ?? 'completed',
    model,
    instructions: null,
    previous_response_id: null,
    metadata: {},
    output: [outputItem],
    usage,
    parallel_tool_calls: true,
    temperature: 1,
    top_p: 1,
    tool_choice: 'auto',
    tools: [],
  };
}

export function createProxyStreamChunk(
  text: string,
  model: string,
  status: 'in_progress' | 'completed',
  options?: {
    responseId?: string;
    itemId?: string;
    outputText?: string;
    rawEvent?: unknown;
    additionalOutputItems?: ProxyResponseOutputItem[];
    usage?: ProxyResponseUsage;
    /** 与 OpenAI Responses API 对齐：有 reasoning 时写入最终 response.output[0].content */
    reasoningSummary?: string;
  }
): string {
  const itemId = options?.itemId ?? `item-${generateId()}`;
  const outputText = options?.outputText ?? text;

  if (status === 'in_progress') {
    const event: Record<string, unknown> = {
      type: 'response.output_text.delta',
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      delta: text,
    };

    return `data: ${JSON.stringify(attachProviderRawEvent(event, options?.rawEvent))}\n\n`;
  }

  const response = createProxyResponse(outputText, model, {
    responseId: options?.responseId,
    itemId,
    status: 'completed',
    usage: options?.usage,
    reasoningSummary: options?.reasoningSummary,
  });
  if (options?.additionalOutputItems?.length) {
    response.output.push(...options.additionalOutputItems);
  }

  const outputTextDoneEvent: Record<string, unknown> = {
    type: 'response.output_text.done',
    item_id: itemId,
    output_index: 0,
    content_index: 0,
    text: outputText,
  };

  const outputItemDoneEvent: Record<string, unknown> = {
    type: 'response.output_item.done',
    output_index: 0,
    item: response.output[0],
  };

  const completedEvent: Record<string, unknown> = {
    type: 'response.completed',
    response,
  };

  return (
    `data: ${JSON.stringify(attachProviderRawEvent(outputTextDoneEvent, options?.rawEvent))}\n\n` +
    `data: ${JSON.stringify(attachProviderRawEvent(outputItemDoneEvent, options?.rawEvent))}\n\n` +
    `data: ${JSON.stringify(attachProviderRawEvent(completedEvent, options?.rawEvent))}\n\n`
  );
}

/**
 * 仅创建 message（output_index 0）的完成事件：output_text.done + output_item.done。
 * 用于按 output_index 顺序发送时，在 tool 完成事件之前发送。
 */
export function createMessageItemDoneStreamChunk(
  outputText: string,
  itemId: string,
  messageItem: ProxyResponseOutputItem,
  options?: { rawEvent?: unknown }
): string {
  const outputTextDoneEvent: Record<string, unknown> = {
    type: 'response.output_text.done',
    item_id: itemId,
    output_index: 0,
    content_index: 0,
    text: outputText,
  };
  const outputItemDoneEvent: Record<string, unknown> = {
    type: 'response.output_item.done',
    output_index: 0,
    item: messageItem,
  };
  return (
    `data: ${JSON.stringify(attachProviderRawEvent(outputTextDoneEvent, options?.rawEvent))}\n\n` +
    `data: ${JSON.stringify(attachProviderRawEvent(outputItemDoneEvent, options?.rawEvent))}\n\n`
  );
}

/**
 * 仅创建 response.completed 事件。用于在 message(0) 与 tool(1+) 完成事件之后发送。
 */
export function createResponseCompletedStreamChunk(
  response: ProxyResponse,
  options?: { rawEvent?: unknown }
): string {
  const completedEvent: Record<string, unknown> = {
    type: 'response.completed',
    response,
  };
  return `data: ${JSON.stringify(attachProviderRawEvent(completedEvent, options?.rawEvent))}\n\n`;
}

/**
 * 创建「思考/推理」摘要流式增量事件（与 output_text 区分，便于客户端判断 thinking）
 * 事件类型：response.reasoning_summary_text.delta，与 OpenAI 5.x+ Responses API 对齐
 */
export function createReasoningDeltaChunk(
  text: string,
  options?: {
    itemId?: string;
    outputIndex?: number;
    /** 摘要部分在 reasoning summary 中的下标，对应 reasoning_summary_text 的 summary_index */
    summaryIndex?: number;
    /** @deprecated 请用 summaryIndex，与 5.x reasoning_summary_text 对齐 */
    contentIndex?: number;
    sequenceNumber?: number;
    rawEvent?: unknown;
  }
): string {
  const summaryIndex = options?.summaryIndex ?? options?.contentIndex ?? 0;
  const event: Record<string, unknown> = {
    type: 'response.reasoning_summary_text.delta',
    item_id: options?.itemId ?? `item-${generateId()}`,
    output_index: options?.outputIndex ?? 0,
    summary_index: summaryIndex,
    sequence_number: options?.sequenceNumber ?? 0,
    delta: text,
  };
  return `data: ${JSON.stringify(attachProviderRawEvent(event, options?.rawEvent))}\n\n`;
}

/**
 * 思考/推理摘要结束事件（可选，在 reasoning 流结束后发送）
 * 事件类型：response.reasoning_summary_text.done，与 OpenAI 5.x+ Responses API 对齐
 */
export function createReasoningDoneChunk(options?: {
  itemId?: string;
  outputIndex?: number;
  /** 摘要部分在 reasoning summary 中的下标，对应 reasoning_summary_text 的 summary_index */
  summaryIndex?: number;
  /** @deprecated 请用 summaryIndex，与 5.x reasoning_summary_text 对齐 */
  contentIndex?: number;
  /** 已完成的摘要全文 */
  text?: string;
  sequenceNumber?: number;
  rawEvent?: unknown;
}): string {
  const summaryIndex = options?.summaryIndex ?? options?.contentIndex ?? 0;
  const event: Record<string, unknown> = {
    type: 'response.reasoning_summary_text.done',
    item_id: options?.itemId ?? `item-${generateId()}`,
    output_index: options?.outputIndex ?? 0,
    summary_index: summaryIndex,
    sequence_number: options?.sequenceNumber ?? 0,
    text: options?.text ?? '',
  };
  return `data: ${JSON.stringify(attachProviderRawEvent(event, options?.rawEvent))}\n\n`;
}

export function createResponseStartedChunk(responseId: string, itemId: string | undefined, model: string): string {
  const response = createProxyResponse('', model, {
    responseId,
    itemId,
    status: 'in_progress',
  });
  response.output = [];
  delete response.usage;

  const createdEvent = {
    type: 'response.created',
    response,
  };

  const outputItemAddedEvent = {
    type: 'response.output_item.added',
    output_index: 0,
    item: {
      id: itemId ?? `item-${generateId()}`,
      type: 'message',
      role: 'assistant',
      status: 'in_progress',
      content: [],
    },
  };

  return (
    `data: ${JSON.stringify(createdEvent)}\n\n` +
    `data: ${JSON.stringify(outputItemAddedEvent)}\n\n`
  );
}

export function createStreamIds(): { responseId: string; itemId: string } {
  return {
    responseId: `resp-${generateId()}`,
    itemId: `item-${generateId()}`,
  };
}

function attachProviderRawEvent<T extends Record<string, unknown>>(
  event: T,
  rawEvent?: unknown
): T & { __provider_raw_event?: unknown } {
  if (rawEvent === undefined) {
    return event;
  }

  return {
    ...event,
    __provider_raw_event: rawEvent,
  };
}

function generateId(length: number = 29): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
