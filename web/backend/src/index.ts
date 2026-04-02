import express from "express";
import cors from "cors";
import { env } from "./utils/env.js";
import { startIndexer } from "./indexer/index.js";
import novelsRouter from "./api/novels.js";
import chaptersRouter from "./api/chapters.js";
import { query } from "./db/index.js";

const app = express();

app.use(cors());
app.use(express.json());

// Health check
app.get("/health", async (_req, res) => {
  try {
    const stateRes = await query("SELECT last_block, updated_at FROM indexer_state WHERE id = 1");
    const state = stateRes.rows[0];
    res.json({
      status: "ok",
      indexer: {
        lastBlock: state?.last_block ?? 0,
        updatedAt: state?.updated_at ?? null,
      },
    });
  } catch (err) {
    res.status(500).json({ status: "error", error: String(err) });
  }
});

// API routes
app.use("/api/novels", novelsRouter);
app.use("/api/chapters", chaptersRouter);

// Start server
app.listen(env.PORT, () => {
  console.log(`API server listening on port ${env.PORT}`);
});

// Start indexer in background
startIndexer().catch(err => {
  console.error("Indexer fatal error:", err);
  process.exit(1);
});
