import { createApiClient, type ApiClient } from "@onchain-novel/shared/api";
import { requireConfig } from "./config.js";

// Lazily create so importing this module doesn't load config.yaml (and thus
// doesn't fail `--help` when contracts aren't deployed yet).
let _client: ApiClient | null = null;
function client(): ApiClient {
  if (!_client) {
    _client = createApiClient({ baseUrl: requireConfig().apiUrl });
  }
  return _client;
}

/** Raw GET — throws on non-2xx. */
export function apiGet<T = unknown>(path: string): Promise<T> {
  const stripped = path.replace(/^\/api/, "");
  return client().get<T>(stripped);
}

export interface ApiPostResult<T> {
  status: number;
  body: T | null;
}

/** Raw POST JSON — returns status + parsed body; does NOT throw on non-2xx. */
export function apiPost<T = unknown>(path: string, body: unknown): Promise<ApiPostResult<T>> {
  const stripped = path.replace(/^\/api/, "");
  return client().post<T>(stripped, body);
}

/**
 * Fetch a novel's on-chain config (fees, durations…) via the backend. Throws if
 * the backend is unreachable or has no config — callers must not silently fall
 * back to hardcoded defaults (a wrong fee wastes gas on a guaranteed revert).
 */
export async function fetchNovelConfig(
  novelId: string | bigint | number,
): Promise<{ novel: Record<string, unknown>; config: Record<string, string> }> {
  const novel = (await client().fetchNovel(novelId as string)) as unknown as Record<string, unknown>;
  const config = novel.config as Record<string, string> | undefined;
  if (!config) {
    throw new Error(
      `Novel #${novelId} has no config in backend response. Pass the fee explicitly via --value.`,
    );
  }
  return { novel, config };
}
