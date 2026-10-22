/** API client: access token lives in memory only; the refresh token is an httpOnly cookie the JS can't read. */
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onLogout: () => void = () => {};

export const setAccessToken = (t: string | null) => { accessToken = t; };
export const setLogoutHandler = (fn: () => void) => { onLogout = fn; };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details: { path?: string; message: string }[] = []) { super(message); }
}

export function refreshSession(): Promise<boolean> {
  // Single flight: concurrent 401s share one refresh call (the server rotates tokens).
  refreshing ??= fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'payrollpro' } })
    .then(async (r) => { if (!r.ok) return false; const b = await r.json(); accessToken = b.accessToken; return true; })
    .catch(() => false)
    .finally(() => { setTimeout(() => { refreshing = null; }, 0); });
  return refreshing;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; retry?: boolean } = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'payrollpro', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && opts.retry !== false && !path.startsWith('/auth/')) {
    if (await refreshSession()) return api<T>(path, { ...opts, retry: false });
    onLogout();
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.code ?? 'error', data.message ?? 'Request failed', data.details ?? []);
  return data as T;
}

export const get = <T = any>(p: string) => api<T>(p);
export const post = <T = any>(p: string, body?: unknown) => api<T>(p, { method: 'POST', body: body ?? {} });
export const put = <T = any>(p: string, body?: unknown) => api<T>(p, { method: 'PUT', body: body ?? {} });
export const del = <T = any>(p: string) => api<T>(p, { method: 'DELETE' });
