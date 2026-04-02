import { Router } from "express";
import { keccak256, toHex, toBytes } from "viem";
import { query } from "../db/index.js";

const router = Router();

// POST /api/content/upload — For External/HTTP mode novels
// Onchain mode doesn't need this (content goes directly in tx)
router.post("/upload", async (req, res) => {
  try {
    const { content, novelId } = req.body;
    if (!content || typeof content !== "string") {
      return res.status(400).json({ error: "content is required" });
    }

    // Check novel's content location
    if (novelId) {
      const novelRes = await query("SELECT content_location FROM novels WHERE id = $1", [novelId]);
      if (novelRes.rows.length > 0 && novelRes.rows[0].content_location === 0) {
        return res.status(400).json({ error: "This novel uses onchain storage. Submit content directly in the transaction." });
      }
    }

    const encoder = new TextEncoder();
    const bytes = encoder.encode(content);
    const contentHash = keccak256(toHex(toBytes(content)));
    const declaredLength = bytes.length;

    // TODO: For External mode, upload to Arweave/IPFS here
    // TODO: For HTTP mode, upload to S3/R2 here
    // For now, just return the hash (content storage backend is pluggable)

    res.json({ contentHash, declaredLength });
  } catch (err) {
    console.error("POST /api/content/upload error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
