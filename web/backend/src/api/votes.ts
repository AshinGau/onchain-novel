import { Router } from "express";
import { query } from "../db/index.js";
import { verifyEip191 } from "../utils/auth.js";
import { encryptVoteSalt } from "../utils/crypto.js";
import { env } from "../utils/env.js";

const router = Router();

const SUBMIT_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

// POST /api/votes/submit
//
// Submit the plaintext (candidateId, salt) for keeper-assisted reveal.
// Body: { novelId, round, address, candidateId, salt, timestamp, signature }
// Canonical message: Submit vote on novel {novelId} round {round} for candidate {candidateId} at {timestamp}
//
// The salt is encrypted at rest with VOTE_ENCRYPTION_KEY. The keeper later
// reads it during the Revealing phase and calls revealVote on-chain.
router.post("/submit", async (req, res) => {
  if (!env.VOTE_ENCRYPTION_KEY) {
    return res.status(503).json({ error: "keeper-assisted reveal disabled (no VOTE_ENCRYPTION_KEY)" });
  }

  try {
    const { novelId, round, address, candidateId, salt, timestamp, signature } = req.body ?? {};

    if (typeof address !== "string" || typeof signature !== "string") {
      return res.status(400).json({ error: "address and signature are required" });
    }
    if (typeof salt !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(salt)) {
      return res.status(400).json({ error: "salt must be a 32-byte hex string (0x-prefixed)" });
    }
    const novelIdNum = Number(novelId);
    const roundNum = Number(round);
    const candidateIdNum = Number(candidateId);
    const ts = Number(timestamp);
    if (!Number.isFinite(novelIdNum) || novelIdNum <= 0) {
      return res.status(400).json({ error: "novelId must be a positive integer" });
    }
    if (!Number.isFinite(roundNum) || roundNum <= 0) {
      return res.status(400).json({ error: "round must be a positive integer" });
    }
    if (!Number.isFinite(candidateIdNum) || candidateIdNum <= 0) {
      return res.status(400).json({ error: "candidateId must be a positive integer" });
    }
    if (!Number.isFinite(ts) || ts <= 0) {
      return res.status(400).json({ error: "timestamp is required (unix seconds)" });
    }
    if (Math.abs(Date.now() - ts * 1000) > SUBMIT_TIMESTAMP_TOLERANCE_MS) {
      return res.status(400).json({ error: "timestamp out of tolerance window" });
    }

    const message = `Submit vote on novel ${novelIdNum} round ${roundNum} for candidate ${candidateIdNum} at ${ts}`;
    const verified = await verifyEip191(address, message, signature);
    if (!verified) {
      return res.status(401).json({ error: "invalid signature" });
    }

    const saltEncrypted = encryptVoteSalt(salt);

    // Upsert: a voter may resubmit before reveal phase if the on-chain commit was retried
    await query(
      `INSERT INTO pending_votes (novel_id, round, voter, candidate_id, salt_encrypted, status)
       VALUES ($1, $2, $3, $4, $5, 'committed')
       ON CONFLICT (novel_id, round, voter)
       DO UPDATE SET candidate_id = EXCLUDED.candidate_id,
                     salt_encrypted = EXCLUDED.salt_encrypted,
                     status = 'committed',
                     created_at = NOW()`,
      [novelIdNum, roundNum, verified, candidateIdNum, saltEncrypted]
    );

    res.status(201).json({ ok: true });
  } catch (err) {
    console.error("POST /api/votes/submit error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
