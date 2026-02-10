import type { ProxyResponse, ProxyResponseOutputItem, ProxyResponseUsage } from '../types';

export function createProxyResponse(
  content: string,
  model: string,
  options?: {
    responseId?: string;
    itemId?: string;
    status?: 'completed' | 'in_progress' | 'failed' | 'incomplete';
    createdAt?: number;
  }
): ProxyResponse {
  const responseId = options?.responseId ?? `resp-${generateId()}`;
  const itemId = options?.itemId ?? `item-${generateId()}`;
  const now = options?.createdAt ?? Math.floor(Date.now() / 1000);
  const usage: ProxyResponseUsage = {
    input_tokens: 0,
    output_tokens: Math.max(content.length, 0),
    total_tokens: Math.max(content.length, 0),
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
    completed_at: options?.status === 'completed' ? now : undefined,
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
    truncation: 'disabled',
    text: { format: { type: 'text' } },
    store: true,
    service_tier: 'auto',
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
  }
): string {
  const itemId = options?.itemId ?? `item-${generateId()}`;
  const outputText = options?.outputText ?? text;

  if (status === 'in_progress') {
    const event = {
      type: 'response.output_text.delta',
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      delta: text,
    };

    return `data: ${JSON.stringify(event)}\n\n`;
  }

  const response = createProxyResponse(outputText, model, {
    responseId: options?.responseId,
    itemId,
    status: 'completed',
  });

  const outputTextDoneEvent = {
    type: 'response.output_text.done',
    item_id: itemId,
    output_index: 0,
    content_index: 0,
    text: outputText,
  };

  const outputItemDoneEvent = {
    type: 'response.output_item.done',
    output_index: 0,
    item: response.output[0],
  };

  const completedEvent = {
    type: 'response.completed',
    response,
  };

  return (
    `data: ${JSON.stringify(outputTextDoneEvent)}\n\n` +
    `data: ${JSON.stringify(outputItemDoneEvent)}\n\n` +
    `data: ${JSON.stringify(completedEvent)}\n\n`
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
  delete response.completed_at;

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

function generateId(length: number = 29): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
