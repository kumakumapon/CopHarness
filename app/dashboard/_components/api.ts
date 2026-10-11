


// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

const DASHBOARD_API_KEY_STORAGE = 'copharness.dashboardApiKey';


function getDashboardApiKey(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(DASHBOARD_API_KEY_STORAGE);
}


export async function dashboardFetch(input: RequestInfo | URL, init: RequestInit = {}, retry = true): Promise<Response> {
  const headers = new Headers(init.headers);
  const apiKey = getDashboardApiKey();
  if (apiKey && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${apiKey}`);
  }

  const res = await fetch(input, { ...init, headers });
  if (res.status !== 401 || !retry || typeof window === 'undefined') return res;

  const nextKey = window.prompt('Dashboard API key');
  if (!nextKey) return res;
  window.localStorage.setItem(DASHBOARD_API_KEY_STORAGE, nextKey);
  return dashboardFetch(input, init, false);
}


export async function fetcher<T>(url: string): Promise<T> {
  const res = await dashboardFetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}
