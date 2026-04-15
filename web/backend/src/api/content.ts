import { Router } from "express";
import { keccak256, toBytes, toHex } from "viem";

import { query } from "../db/index.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("api:content");
const router = Router();

// Maximum body size accepted by this endpoint (matches contract maxChapterLength ceiling).
const MAX_CONTENT_BYTES = 50_000;

/**
 * POST /api/content/hash — Compute (contentHash, declaredLength) from UTF-8 text.
 *
 * For Onchain novels the submitter passes `content` as tx calldata; this endpoint is a
 * convenience for clients that want the hash without pulling in a viem bundle. For External
 * (IPFS/Arweave) or HTTP novels the client handles storage upload itself — the backend does
 * not persist the blob.
 */
router.post("/hash", async (req, res) => {
  try {
    const { content, novelId } = req.body;
    if (typeof content !== "string" || content.length === 0) {
      return res.status(400).json({ error: "content is required" });
    }

    const bytes = new TextEncoder().encode(content);
    if (bytes.length > MAX_CONTENT_BYTES) {
      return res.status(413).json({ error: `content exceeds ${MAX_CONTENT_BYTES} bytes` });
    }

    if (novelId) {
      const nid = String(novelId);
      if (!/^\d+$/.test(nid)) {
        return res.status(400).json({ error: "novelId must be a positive integer" });
      }
      const novelRes = await query("SELECT content_location FROM novels WHERE id = $1", [nid]);
      if (novelRes.rows.length > 0 && novelRes.rows[0].content_location === 0) {
        // Informational: the caller can still hash, but reminds them onchain mode bundles
        // content into the tx rather than using any external upload pipeline.
        res.setHeader("X-Content-Mode", "onchain");
      }
    }

    const contentHash = keccak256(toHex(toBytes(content)));
    res.json({ contentHash, declaredLength: bytes.length });
  } catch (err) {
    log.error({ err }, "POST /api/content/hash error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
