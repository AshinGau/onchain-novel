import { resolve } from "node:path";

import type { NextConfig } from "next";
import { bootstrapConfig } from "@onchain-novel/shared";

// Resolve the deployment address book at build/dev start by walking NovelCore's
// on-chain getters. Replaces the 7-field config block in YAML with a single
// `contracts.novelCore` plus a multicall here. Requires the RPC to be reachable
// during `next build` / `next dev` startup — that's the same trade as needing
// a valid YAML before, just shifted from "team commits all 7 addresses" to
// "team commits 1 address + chain is live".
//
// The async-function export form is required: Next compiles next.config.ts to
// CommonJS, which doesn't support top-level await. The async-thunk form is
// documented as supported since Next 12.1.
export default async function config(): Promise<NextConfig> {
  const { config: cfg, chainId, contracts } = await bootstrapConfig({ searchFrom: __dirname });

  // Monorepo root — the committed package-lock.json lives there. Telling Next
  // explicitly avoids its "inferred workspace root" warning and stops it from
  // trying to patch a non-existent lockfile in web/frontend.
  const monorepoRoot = resolve(__dirname, "..", "..");

  return {
    devIndicators: false,
    outputFileTracingRoot: monorepoRoot,
    turbopack: { root: monorepoRoot },
    // Cross-origin dev-server callers (e.g. phone at 192.168.1.2 hitting HMR).
    // Empty = same-origin only. Populated from config.yaml:frontend.allowedDevOrigins.
    ...(cfg.frontend.allowedDevOrigins.length > 0
      ? { allowedDevOrigins: cfg.frontend.allowedDevOrigins }
      : {}),
    // Expose a minimal, non-secret subset to both server (SSR/RSC) and browser
    // bundles. Everything here is compiled in at build time — do not put secrets
    // in. NEXT_PUBLIC_* are also exposed to the browser; BACKEND_URL is server-only
    // (its purpose is SSR fetches that need an absolute URL — browser code uses
    // a relative /api path proxied through Next).
    env: {
      NEXT_PUBLIC_RPC_URL: cfg.chain.rpcUrl,
      NEXT_PUBLIC_CHAIN_ID: String(chainId),
      NEXT_PUBLIC_NOVEL_CORE: contracts.novelCore,
      NEXT_PUBLIC_ROUND_MANAGER: contracts.roundManager,
      NEXT_PUBLIC_VOTING_ENGINE: contracts.votingEngine,
      NEXT_PUBLIC_PRIZE_POOL: contracts.prizePool,
      NEXT_PUBLIC_BOUNTY_BOARD: contracts.bountyBoard,
      NEXT_PUBLIC_RULES_ENGINE: contracts.rulesEngine,
      NEXT_PUBLIC_USER_REGISTRY: contracts.userRegistry,
      BACKEND_URL: cfg.frontend.backendUrl,
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
}
