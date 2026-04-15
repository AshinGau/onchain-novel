import { requireConfig } from "./config.js";

function apiBase(): string {
  const config = requireConfig();
  if (!config.apiUrl) {
    console.error("No apiUrl in config. Run 'onchain-novel config set apiUrl <url>'.");
    process.exit(1);
  }
  return config.apiUrl;
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const base = apiBase();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`);
  } catch (err) {
    throw new Error(
      `Cannot reach API at ${base} — is the backend running? (${err instanceof Error ? err.message : err})`,
    );
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json() as T;
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
  const base = apiBase();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `Cannot reach API at ${base} — is the backend running? (${err instanceof Error ? err.message : err})`,
    );
  }
  let parsed: T | null = null;
  try {
    parsed = (await res.json()) as T;
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}
