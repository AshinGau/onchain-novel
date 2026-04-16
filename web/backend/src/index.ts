import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import pinoHttp from "pino-http";

import bountiesRouter from "./api/bounties.js";
import chaptersRouter from "./api/chapters.js";
import contentRouter from "./api/content.js";
import novelsRouter from "./api/novels.js";
import rulesRouter from "./api/rules.js";
import usersRouter from "./api/users.js";
import votesRouter from "./api/votes.js";
import { query } from "./db/index.js";
import { retryUnfetchedContent } from "./indexer/content-fetcher.js";
import { startIndexer } from "./indexer/index.js";
import { startKeeper } from "./keeper/index.js";
import { loadKey } from "./utils/crypto.js";
import { env } from "./utils/env.js";
import { createLogger, logger } from "./utils/logger.js";
import { syncPoolBalances } from "./utils/pool-sync.js";

const log = createLogger("server");
const app = express();

// Validate the vote-encryption key at boot when configured, so a malformed key fails fast
// instead of surfacing on the first POST /api/votes/submit.
if (env.VOTE_ENCRYPTION_KEY) {
  try {
    loadKey();
  } catch (err) {
    log.error({ err }, "Invalid VOTE_ENCRYPTION_KEY");
    process.exit(1);
  }
}

// CORS: explicit allow-list via FRONTEND_URL (comma-separated). In production we require it
// to be set so we never silently disable CORS or fall back to a dev origin.
// In dev (no FRONTEND_URL set) we allow localhost/127.0.0.1 and private LAN ranges
// (10.x.x.x, 172.16–31.x.x, 192.168.x.x) so testing on a mobile phone over LAN works.
const parsedOrigins = (process.env.FRONTEND_URL ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (process.env.NODE_ENV === "production" && parsedOrigins.length === 0) {
  log.error("FRONTEND_URL must be set in production");
  process.exit(1);
}
const LAN_HOSTNAME =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;
const corsOriginCheck: cors.CorsOptions["origin"] = (origin, callback) => {
  // Allow non-browser tools (curl, server-to-server) which omit Origin.
  if (!origin) return callback(null, true);
  if (parsedOrigins.length > 0) {
    return callback(null, parsedOrigins.includes(origin));
  }
  // Dev fallback: any host in the local/LAN range.
  try {
    const host = new URL(origin).hostname;
    return callback(null, LAN_HOSTNAME.test(host));
  } catch {
    return callback(null, false);
  }
};
app.use(cors({ origin: corsOriginCheck }));
app.use(helmet());
app.use(express.json());

app.use(
  pinoHttp({
    logger,
    autoLogging: { ignore: (req) => req.url === "/health" },
  }),
);

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 60000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});
const writeLimiter = rateLimit({
  windowMs: 60000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});
const heavyLimiter = rateLimit({
  windowMs: 60000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api", apiLimiter);
app.use("/api/chapters/*/comments", writeLimiter);
app.use("/api/votes/submit", writeLimiter);
// Recursive / aggregation endpoints — stricter limit
app.use("/api/chapters/*/context", heavyLimiter);
app.use("/api/novels/*/stats", heavyLimiter);
app.use("/api/novels/*/tree", heavyLimiter);

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
app.use("/api/users", usersRouter);

app.use("/api/content", contentRouter);
app.use("/api/bounties", bountiesRouter);
app.use("/api/votes", votesRouter);
app.use("/api", rulesRouter);

app.listen(env.PORT, () => {
  log.info({ port: env.PORT }, "API server listening");
});

startIndexer().catch((err) => {
  log.error({ err }, "Indexer fatal error");
  process.exit(1);
});

setInterval(
  () => {
    retryUnfetchedContent().catch((err) => log.error({ err }, "Content retry error"));
  },
  5 * 60 * 1000,
);

setInterval(() => {
  syncPoolBalances().catch((err) => log.error({ err }, "Pool balance sync error"));
}, 60 * 1000);

startKeeper();
