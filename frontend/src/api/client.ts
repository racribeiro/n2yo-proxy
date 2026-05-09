const defaultBackendUrl =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:4000`
    : 'http://localhost:4000';

export const getBackendUrl = (): string =>
  localStorage.getItem('backend_url') ?? import.meta.env.VITE_BACKEND_URL ?? defaultBackendUrl;

export const setBackendUrl = (value: string): void => {
  localStorage.setItem('backend_url', value);
};

export const getProxyApiKey = (): string => localStorage.getItem('proxy_api_key') ?? 'change-me';

export const setProxyApiKey = (value: string): void => {
  localStorage.setItem('proxy_api_key', value);
};

export const buildUrl = (path: string, query: Record<string, string | number | undefined> = {}): string => {
  const apiBase = getBackendUrl().replace(/\/+$/, '');
  const params = new URLSearchParams();
  params.set('apiKey', getProxyApiKey());
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  return `${apiBase}${path}?${params.toString()}`;
};

export const apiGet = async <T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> => {
  const res = await fetch(buildUrl(path, query));
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as T;
};

export const apiPatch = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
  const res = await fetch(buildUrl(path), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as T;
};

export const apiPost = async <T>(path: string, body?: Record<string, unknown>): Promise<T> => {
  const res = await fetch(buildUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {})
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as T;
};
