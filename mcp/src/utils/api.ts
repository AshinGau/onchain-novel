import { config } from "../config.js";

const DEFAULT_TIMEOUT_MS = 10_000;

/** Whether the backend REST API is configured. */
export function hasApi(): boolean {
  return config.apiBaseUrl.length > 0;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch JSON from the backend REST API. */
export async function apiGet<T = unknown>(path: string): Promise<T> {
  if (!config.apiBaseUrl) {
    throw new Error("API_BASE_URL is not configured");
  }
  const url = `${config.apiBaseUrl}${path}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${url} ${body}`);
  }
  return res.json() as Promise<T>;
}

export interface ApiPostResult<T> {
  status: number;
  body: T | null;
}

/**
 * POST a JSON body. Returns status + parsed body. Does NOT throw on non-2xx —
 * the caller decides how to handle backend errors (e.g. 503 for disabled features).
 */
export async function apiPost<T = unknown>(path: string, body: unknown): Promise<ApiPostResult<T>> {
  if (!config.apiBaseUrl) {
    throw new Error("API_BASE_URL is not configured");
  }
  const res = await fetchWithTimeout(`${config.apiBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let parsed: T | null = null;
  try {
    parsed = (await res.json()) as T;
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}
