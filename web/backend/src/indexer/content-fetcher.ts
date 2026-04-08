import { query } from "../db/index.js";
import { ContentLocation } from "../utils/validate.js";

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchChapterContent(chapterId: bigint, novelId: bigint) {
  const maxRetries = 5;

  // Get content URL parts
  const novelRes = await query("SELECT config, content_location FROM novels WHERE id = $1", [novelId.toString()]);
  if (novelRes.rows.length === 0) return;

  // Onchain content is decoded from tx calldata in the event handler, not external fetch
  if (novelRes.rows[0].content_location === ContentLocation.Onchain) return;

  const config = novelRes.rows[0].config;
  const baseUrl: string = config.contentBaseUrl || "";
  if (!baseUrl) return; // No base URL configured, skip content fetch

  const chapterRes = await query("SELECT content_hash, content_fetched FROM chapters WHERE id = $1", [chapterId.toString()]);
  if (chapterRes.rows.length === 0 || chapterRes.rows[0].content_fetched) return;

  const contentHash: string = chapterRes.rows[0].content_hash;
  // Remove 0x prefix if present for URL construction
  const hashForUrl = contentHash.startsWith("0x") ? contentHash.slice(2) : contentHash;
  const url = `${baseUrl}${hashForUrl}`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const text = await response.text();

      await query(
        "UPDATE chapters SET content_text = $1, content_fetched = TRUE WHERE id = $2",
        [text, chapterId.toString()]
      );
      return;
    } catch (err) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
      console.warn(`Content fetch attempt ${attempt + 1}/${maxRetries} failed for chapter ${chapterId}: ${err instanceof Error ? err.message : err}. Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }

  console.error(`Failed to fetch content for chapter ${chapterId} after ${maxRetries} attempts`);
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
    [ContentLocation.Onchain]
  );

  for (const row of res.rows) {
    await fetchChapterContent(BigInt(row.id), BigInt(row.novel_id));
  }
}
