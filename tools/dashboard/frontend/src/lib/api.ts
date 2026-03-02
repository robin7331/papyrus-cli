const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

function buildQuery(params?: Record<string, string | number | undefined>): string {
  if (!params) {
    return "";
  }

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") {
      continue;
    }
    search.set(key, String(value));
  }

  const queryString = search.toString();
  return queryString ? `?${queryString}` : "";
}

export async function apiGet<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const response = await fetch(`${API_BASE}${path}${buildQuery(params)}`);
  if (!response.ok) {
    const fallback = `API-Fehler ${response.status}`;
    const body = await response.json().catch(() => null);
    const message = body?.error?.message ?? fallback;
    throw new Error(message);
  }

  return (await response.json()) as T;
}
