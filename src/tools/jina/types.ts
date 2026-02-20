/**
 * Request/response types for Jina Reader and Search APIs.
 */

export interface JinaReaderRequest {
  url: string;
  viewport?: { width: number; height: number };
  injectPageScript?: string;
}

export interface JinaReaderResponse {
  code: number;
  status: number;
  data?: {
    title?: string;
    description?: string;
    url?: string;
    content?: string;
    images?: Record<string, string>;
    links?: Record<string, string>;
    usage?: { tokens?: number };
  };
}

export interface JinaSearchRequest {
  q: string;
  gl?: string;
  location?: string;
  hl?: string;
  num?: number;
  page?: number;
}

export interface JinaSearchResultItem {
  title?: string;
  description?: string;
  url?: string;
  content?: string;
  usage?: { tokens?: number };
}

export interface JinaSearchResponse {
  code: number;
  status: number;
  data?: JinaSearchResultItem[];
}
