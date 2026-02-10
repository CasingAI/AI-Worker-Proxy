import type {
  ResponseContentBlock,
  ResponseDoneEvent,
  ResponseObject,
  ResponseOutputItem,
  ResponseStartedEvent,
  OutputTextDeltaEvent,
  ProviderData,
  ResponseUsage,
} from '../types/AgentSDK/AgentSDK';

export function createProxyResponse(
  content: string,
  model: string,
  options?: {
    responseId?: string;
    itemId?: string;
    status?: 'completed' | 'in_progress' | 'failed';
    createdAt?: number;
  }
): ResponseObject {
  const responseId = options?.responseId ?? `resp-${generateId()}`;
  const itemId = options?.itemId ?? `item-${generateId()}`;
  const now = options?.createdAt ?? Math.floor(Date.now() / 1000);
  const usage: ResponseUsage = {
    input_tokens: 0,
    output_tokens: Math.max(content.length, 0),
    total_tokens: Math.max(content.length, 0),
  };

  const contentBlock: ResponseContentBlock = {
    type: 'output_text',
    text: content,
    annotations: [],
  };

  const outputItem: ResponseOutputItem = {
    id: itemId,
    type: 'message',
    role: 'assistant',
    status: options?.status ?? 'completed',
    content: [contentBlock],
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
    output_text: content,
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
  const providerData: ProviderData = {};
  if (options?.responseId) {
    providerData.responseId = options.responseId;
  }
  if (options?.itemId) {
    providerData.itemId = options.itemId;
  }

  if (status === 'in_progress') {
    const event: OutputTextDeltaEvent = {
      type: 'output_text_delta',
      delta: text,
      providerData,
      itemId: options?.itemId,
      outputIndex: 0,
      contentIndex: 0,
    };

    return `data: ${JSON.stringify(event)}\n\n`;
  }

  const response = createProxyResponse(options?.outputText ?? text, model, {
    responseId: options?.responseId,
    itemId: options?.itemId,
    status: 'completed',
  });

  const event: ResponseDoneEvent = {
    type: 'response_done',
    response,
    providerData,
  };

  return `data: ${JSON.stringify(event)}\n\n`;
}

export function createResponseStartedChunk(responseId: string, itemId?: string): string {
  const event: ResponseStartedEvent = {
    type: 'response_started',
    providerData: {
      responseId,
      itemId,
    },
  };

  return `data: ${JSON.stringify(event)}\n\n`;
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
