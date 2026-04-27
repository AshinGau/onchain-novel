import { query } from "../db/index.js";
import { createLogger } from "../utils/logger.js";
import { ContentLocation } from "../utils/validate.js";

const log = createLogger("indexer:content-fetcher");

// Protection against malicious contentBaseUrl: bound wall-clock and response size.
const FETCH_TIMEOUT_MS = 10_000;
const FETCH_MAX_BYTES = 2 * 1024 * 1024; // 2 MiB — well above the 50 KB contract chapter cap

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchBounded(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  // Reject overly large payloads before reading the body.
  const declared = response.headers.get("content-length");
  if (declared && Number.parseInt(declared, 10) > FETCH_MAX_BYTES) {
    throw new Error(`content-length ${declared} exceeds cap ${FETCH_MAX_BYTES}`);
  }

  // Stream the body and enforce the cap incrementally in case no content-length is set.
  const reader = response.body?.getReader();
  if (!reader) return response.text();

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > FETCH_MAX_BYTES) {
      reader.cancel().catch(() => {});
      throw new Error(`response exceeds cap ${FETCH_MAX_BYTES}`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
}

/**
 * Reject http(s) URLs whose host is loopback / link-local / private / metadata-service.
 * Prevents SSRF from a malicious novel config.contentBaseUrl.
 */
function isSafeHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host === "ip6-localhost" || host === "ip6-loopback") return false;
  // IPv6 literals: strip brackets already stripped by URL
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return false;
  // fc00::/7 (unique-local), fe80::/10 (link-local)
  if (/^(fc|fd)[0-9a-f]{2}:/.test(host)) return false;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return false;
  // IPv4 literal?
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const o = m.slice(1).map(Number);
    if (o.some((x) => x > 255)) return false;
    // 10/8
    if (o[0] === 10) return false;
    // 127/8
    if (o[0] === 127) return false;
    // 0/8
    if (o[0] === 0) return false;
    // 169.254/16
    if (o[0] === 169 && o[1] === 254) return false;
    // 172.16/12
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return false;
    // 192.168/16
    if (o[0] === 192 && o[1] === 168) return false;
    // 100.64/10 (CGNAT)
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return false;
  }
  return true;
}

export async function fetchChapterContent(chapterId: bigint, novelId: bigint) {
  const maxRetries = 5;

  // Get content URL parts
  const novelRes = await query("SELECT config, content_location FROM novels WHERE id = $1", [
    novelId.toString(),
  ]);
  if (novelRes.rows.length === 0) return;

  // Onchain content is decoded from tx calldata in the event handler, not external fetch
  if (novelRes.rows[0].content_location === ContentLocation.Onchain) return;

  // contract enforces contentBaseUrl is non-empty when contentLocation !=
  // Onchain (NovelCore.validateConfig, InvalidConfig(10)). The Onchain branch
  // already returned above, so baseUrl is guaranteed non-empty here.
  const baseUrl: string = novelRes.rows[0].config.contentBaseUrl;

  const chapterRes = await query(
    "SELECT content_hash, content_fetched FROM chapters WHERE id = $1",
    [chapterId.toString()],
  );
  if (chapterRes.rows.length === 0 || chapterRes.rows[0].content_fetched) return;

  const contentHash: string = chapterRes.rows[0].content_hash;
  // Remove 0x prefix if present for URL construction
  const hashForUrl = contentHash.startsWith("0x") ? contentHash.slice(2) : contentHash;
  const url = `${baseUrl}${hashForUrl}`;

  if (!isSafeHttpUrl(url)) {
    log.warn({ chapterId }, "Refusing to fetch unsafe URL (host blocked)");
    return;
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const text = await fetchBounded(url);

      await query("UPDATE chapters SET content_text = $1, content_fetched = TRUE WHERE id = $2", [
        text,
        chapterId.toString(),
      ]);
      return;
    } catch (err) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
      log.warn(
        {
          chapterId,
          attempt: attempt + 1,
          maxRetries,
          delay,
          err: err instanceof Error ? err.message : String(err),
        },
        "Content fetch attempt failed, retrying",
      );
      await sleep(delay);
    }
  }

  log.error({ chapterId, maxRetries }, "Failed to fetch content after retries");
}

/**
 * Periodically retry fetching content for chapters that failed initial fetch.
 * Call this on a timer (e.g. every 5 minutes).
 */
export async function retryUnfetchedContent() {
  const res = await query(
    `SELECT c.id, c.novel_id FROM chapters c
     JOIN novels n ON n.id = c.novel_id
     WHERE c.content_fetched = FALSE AND n.content_location != $1 AND COALESCE(n.config->>'contentBaseUrl', '') != ''
     LIMIT 20`,
    [ContentLocation.Onchain],
  );

  for (const row of res.rows) {
    await fetchChapterContent(BigInt(row.id), BigInt(row.novel_id));
  }
}
