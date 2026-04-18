import { resolve } from "node:path";

import type { NextConfig } from "next";
import { loadConfig } from "@onchain-novel/shared";

// Load once at build/dev start. Changing config.yaml requires restarting the
// dev server (or rebuilding for prod) — build-time is the tradeoff we accepted
// for type safety and zero runtime overhead.
const cfg = loadConfig({ searchFrom: __dirname });

// Monorepo root — the committed package-lock.json lives there. Telling Next
// explicitly avoids its "inferred workspace root" warning and stops it from
// trying to patch a non-existent lockfile in web/frontend.
const monorepoRoot = resolve(__dirname, "..", "..");

// Backend runs on the same host as Next.js. /api/* is proxied through Next.js
// so the browser only ever talks to one origin — no CORS, no per-device
// rebuild, no hardcoded IPs in source.
const nextConfig: NextConfig = {
  devIndicators: false,
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  // Cross-origin dev-server callers (e.g. phone at 192.168.1.2 hitting HMR).
  // Empty = same-origin only. Populated from config.yaml:frontend.allowedDevOrigins.
  ...(cfg.frontend.allowedDevOrigins.length > 0
    ? { allowedDevOrigins: cfg.frontend.allowedDevOrigins }
    : {}),
  // Expose a minimal, non-secret subset to the browser bundle. Everything here
  // is compiled into the client JS at build time — do not put secrets in.
  env: {
    NEXT_PUBLIC_RPC_URL: cfg.chain.rpcUrl,
    NEXT_PUBLIC_CHAIN_ID: String(cfg.chain.chainId),
    NEXT_PUBLIC_NOVEL_CORE: cfg.contracts.novelCore ?? "",
    NEXT_PUBLIC_ROUND_MANAGER: cfg.contracts.roundManager ?? "",
    NEXT_PUBLIC_VOTING_ENGINE: cfg.contracts.votingEngine ?? "",
    NEXT_PUBLIC_PRIZE_POOL: cfg.contracts.prizePool ?? "",
    NEXT_PUBLIC_BOUNTY_BOARD: cfg.contracts.bountyBoard ?? "",
    NEXT_PUBLIC_RULES_ENGINE: cfg.contracts.rulesEngine ?? "",
    NEXT_PUBLIC_USER_REGISTRY: cfg.contracts.userRegistry ?? "",
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${cfg.frontend.backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
