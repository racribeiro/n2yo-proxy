const API_BASE = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

export const getProxyApiKey = (): string => localStorage.getItem('proxy_api_key') ?? 'change-me';

export const setProxyApiKey = (value: string): void => {
  localStorage.setItem('proxy_api_key', value);
};

export const buildUrl = (path: string, query: Record<string, string | number | undefined> = {}): string => {
  const params = new URLSearchParams();
  params.set('apiKey', getProxyApiKey());
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  return `${API_BASE}${path}?${params.toString()}`;
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

export { API_BASE };
