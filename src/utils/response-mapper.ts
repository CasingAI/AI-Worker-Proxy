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

  const outputItem: ProxyResponseOutputItem = {
    id: itemId,
    type: 'message',
    role: 'assistant',
    status: options?.status ?? 'completed',
    content: [
      {
        type: 'output_text',
        text: content,
        annotations: [],
      },
    ],
  };

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
