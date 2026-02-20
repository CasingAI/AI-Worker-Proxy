import type { Env } from '../../types';
import type {
  JinaReaderRequest,
  JinaReaderResponse,
  JinaSearchRequest,
  JinaSearchResponse,
} from './types';

const READER_URL = 'https://r.jina.ai/';
const SEARCH_URL = 'https://s.jina.ai/';

function getApiKeys(env: Env): string[] {
  const keys: string[] = [];
  let names: string[] = [];
  try {
    const raw = env.JINA_API_KEYS ?? '[]';
    const parsed = JSON.parse(typeof raw === 'string' ? raw : '[]') as unknown;
    names = Array.isArray(parsed) ? (parsed as string[]).map((s) => String(s).trim()).filter(Boolean) : [];
  } catch {
    names = [];
  }
  if (names.length === 0 && env.JINA_API_KEY) {
    keys.push(env.JINA_API_KEY);
    return keys;
  }
  for (const name of names) {
    const value = env[name];
    if (value) keys.push(value);
  }
  return keys;
}

async function readerWithKey(url: string, apiKey: string, options?: Partial<JinaReaderRequest>): Promise<JinaReaderResponse> {
  const res = await fetch(READER_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ url, ...options }),
  });
  const data = (await res.json()) as JinaReaderResponse;
  if (!res.ok) {
    const err = new Error((data as any)?.message ?? res.statusText) as Error & { statusCode?: number };
    err.statusCode = res.status;
    throw err;
  }
  return data;
}

async function searchWithKey(
  params: JinaSearchRequest,
  apiKey: string
): Promise<JinaSearchResponse> {
  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(params),
  });
  const data = (await res.json()) as JinaSearchResponse;
  if (!res.ok) {
    const err = new Error((data as any)?.message ?? res.statusText) as Error & { statusCode?: number };
    err.statusCode = res.status;
    throw err;
  }
  return data;
}

const RETRYABLE_STATUS = new Set([429, 502, 503]);

export async function jinaReader(
  env: Env,
  request: JinaReaderRequest
): Promise<{ success: true; data: JinaReaderResponse } | { success: false; error: string; statusCode?: number }> {
  const keys = getApiKeys(env);
  if (keys.length === 0) {
    return { success: false, error: 'No Jina API keys configured (JINA_API_KEYS or JINA_API_KEY)', statusCode: 500 };
  }
  let lastError: string | undefined;
  let lastStatus: number | undefined;
  for (const key of keys) {
    try {
      const data = await readerWithKey(request.url, key, request);
      return { success: true, data };
    } catch (e: any) {
      lastError = e?.message ?? String(e);
      lastStatus = e?.statusCode;
      if (lastStatus != null && !RETRYABLE_STATUS.has(lastStatus)) break;
    }
  }
  return {
    success: false,
    error: lastError ?? 'Jina Reader failed',
    statusCode: lastStatus ?? 500,
  };
}

export async function jinaSearch(
  env: Env,
  request: JinaSearchRequest
): Promise<{ success: true; data: JinaSearchResponse } | { success: false; error: string; statusCode?: number }> {
  const keys = getApiKeys(env);
  if (keys.length === 0) {
    return { success: false, error: 'No Jina API keys configured (JINA_API_KEYS or JINA_API_KEY)', statusCode: 500 };
  }
  let lastError: string | undefined;
  let lastStatus: number | undefined;
  for (const key of keys) {
    try {
      const data = await searchWithKey(request, key);
      return { success: true, data };
    } catch (e: any) {
      lastError = e?.message ?? String(e);
      lastStatus = e?.statusCode;
      if (lastStatus != null && !RETRYABLE_STATUS.has(lastStatus)) break;
    }
  }
  return {
    success: false,
    error: lastError ?? 'Jina Search failed',
    statusCode: lastStatus ?? 500,
  };
}
