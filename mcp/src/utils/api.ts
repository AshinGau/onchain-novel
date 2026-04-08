import { config } from "../config.js";

/** Whether the backend REST API is configured. */
export function hasApi(): boolean {
  return config.apiBaseUrl.length > 0;
}

/** Fetch JSON from the backend REST API. */
export async function apiGet<T = unknown>(path: string): Promise<T> {
  if (!config.apiBaseUrl) {
    throw new Error("API_BASE_URL is not configured");
  }
  const url = `${config.apiBaseUrl}${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${url} ${body}`);
  }
  return res.json() as Promise<T>;
}
