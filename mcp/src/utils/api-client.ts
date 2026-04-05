import { config } from "../config.js";

/**
 * Whether the Web API backend is configured.
 */
export function hasApi(): boolean {
  return config.apiBaseUrl.length > 0;
}

/**
 * Fetch JSON from the Web API backend.
 * Throws if API_BASE_URL is not configured.
 */
export async function apiFetch<T>(path: string): Promise<T> {
  if (!config.apiBaseUrl) {
    throw new Error("API_BASE_URL is not configured");
  }
  const url = `${config.apiBaseUrl}${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}: ${url}`);
  return res.json() as Promise<T>;
}
