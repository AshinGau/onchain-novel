import { requireConfig } from "./config.js";

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const config = requireConfig();
  if (!config.apiUrl) {
    console.error("No apiUrl in config. Run 'onchain-novel config set apiUrl <url>'.");
    process.exit(1);
  }
  const url = `${config.apiUrl}${path}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Cannot reach API at ${config.apiUrl} — is the backend running? (${err instanceof Error ? err.message : err})`);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json() as T;
}
