import type { ApiError } from '@/domains/sessions/types';

export interface ApiClientOptions {
  baseUrl?: string;
}

export interface ApiClient {
  get<T>(path: string, signal?: AbortSignal): Promise<T>;
  post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T>;
  del<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T>;
}

class ApiClientError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
  }
}

export function createApiClient(options?: ApiClientOptions): ApiClient {
  const baseUrl = options?.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? '';

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = `${baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal,
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}`;
      try {
        const errorBody = (await response.json()) as ApiError;
        errorMessage = errorBody.error ?? errorMessage;
      } catch {
        // Response may not be JSON
      }
      throw new ApiClientError(errorMessage, response.status);
    }

    return (await response.json()) as T;
  }

  return {
    get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, signal),
    post: <T>(path: string, body?: unknown, signal?: AbortSignal) => request<T>('POST', path, body, signal),
    del: <T>(path: string, body?: unknown, signal?: AbortSignal) => request<T>('DELETE', path, body, signal),
  };
}

/** Singleton API client instance */
export const api = createApiClient();
