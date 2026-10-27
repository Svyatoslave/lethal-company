import { clearToken, tokenOf, type App } from './session';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = unknown>(app: App, method: string, url: string, body?: unknown): Promise<T> {
  const token = tokenOf(app);
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'НЕТ СВЯЗИ С СЕРВЕРОМ');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 401 && token && !url.startsWith('/auth/')) clearToken(app);
    throw new ApiError(res.status, data.error ?? `СБОЙ СИСТЕМЫ (${res.status})`);
  }
  return data as T;
}

/** Idempotency key: the same key is reused for every retry of one intended action. */
export function requestId() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
