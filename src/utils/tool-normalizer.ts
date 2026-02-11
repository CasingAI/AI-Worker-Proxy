import { Tool, ToolChoice } from '../types';

export interface NormalizedFunctionTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: boolean;
}

export type ResponsesToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; name: string };

export type ChatToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } };

export function normalizeFunctionTools(tools?: Tool[]): NormalizedFunctionTool[] {
  if (!tools || tools.length === 0) {
    return [];
  }

  const normalized: NormalizedFunctionTool[] = [];

  for (const tool of tools) {
    if (!tool || tool.type !== 'function') {
      continue;
    }

    const toolRecord = toRecord(tool);
    const functionRecord = toRecord(toolRecord?.function);

    const name = pickString(functionRecord?.name) ?? pickString(toolRecord?.name);
    if (!name) {
      continue;
    }

    normalized.push({
      name,
      description:
        pickString(functionRecord?.description) ?? pickString(toolRecord?.description) ?? '',
      parameters:
        toRecord(functionRecord?.parameters) ?? toRecord(toolRecord?.parameters) ?? {},
      strict: pickBoolean(toolRecord?.strict) ?? true,
    });
  }

  return normalized;
}

export function mapToolChoiceToResponses(choice?: ToolChoice): ResponsesToolChoice | undefined {
  if (!choice) {
    return undefined;
  }

  if (choice === 'auto' || choice === 'none' || choice === 'required') {
    return choice;
  }

  const choiceRecord = toRecord(choice);
  if (!choiceRecord || choiceRecord.type !== 'function') {
    return undefined;
  }

  const functionRecord = toRecord(choiceRecord.function);
  const name = pickString(functionRecord?.name) ?? pickString(choiceRecord.name);
  if (!name) {
    return undefined;
  }

  return {
    type: 'function',
    name,
  };
}

export function mapToolChoiceToChat(choice?: ToolChoice): ChatToolChoice | undefined {
  if (!choice) {
    return undefined;
  }

  if (choice === 'auto' || choice === 'none' || choice === 'required') {
    return choice;
  }

  const choiceRecord = toRecord(choice);
  if (!choiceRecord || choiceRecord.type !== 'function') {
    return undefined;
  }

  const functionRecord = toRecord(choiceRecord.function);
  const name = pickString(functionRecord?.name) ?? pickString(choiceRecord.name);
  if (!name) {
    return undefined;
  }

  return {
    type: 'function',
    function: { name },
  };
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function pickString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function pickBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
