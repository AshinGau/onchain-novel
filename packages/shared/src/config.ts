import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import YAML from "yaml";
import { z } from "zod";

// ────────────────────────────────────────────────────────────────────────────
// Schema
// ────────────────────────────────────────────────────────────────────────────

// Accept string OR number — YAML may parse 0x-only-digits addresses as numbers
// when they happen to contain no a-f letters. Always coerce to string before
// validating. A 40-hex-char address can't overflow if treated as a number on
// rare occasions because YAML 1.2 doesn't even parse hex integers by default,
// but YAML 1.1 (which some loaders still use) does — this guard makes us
// robust to either.
const addressLike = z.union([z.string(), z.number()]).transform((v) => String(v));

const hexAddress = addressLike.pipe(
  z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "expected 0x-prefixed 20-byte hex address")
    .transform((s) => s as `0x${string}`),
);

const optionalHexAddress = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    const s = String(v);
    return s.length > 0 ? (s as `0x${string}`) : undefined;
  });

const ChainSchema = z.object({
  rpcUrl: z.string().url(),
  // Optional: when omitted, callers resolve via `eth_chainId` against rpcUrl
  // (see bootstrapConfig). Keep it as an explicit override for offline tooling
  // or for sanity-checking against an expected network.
  chainId: z.number().int().positive().optional(),
});

// All non-novelCore addresses are derivable on-chain from NovelCore via
// resolveContracts(). novelCore is the single field that can't be derived;
// everything else is intentionally absent from the schema. If you find
// yourself wanting to pin a non-novelCore address here, you almost certainly
// want to fix the deployment instead — keeping config in sync with on-chain
// truth is the whole point.
const ContractsSchema = z.object({
  novelCore: optionalHexAddress,
});

const IndexerSchema = z.object({
  startBlock: z.number().int().nonnegative().default(0),
  pollIntervalMs: z.number().int().positive().default(5000),
  confirmationBlocks: z.number().int().nonnegative().default(12),
  batchSize: z.number().int().positive().default(100),
});

const KeeperSchema = z.object({
  pollIntervalMs: z.number().int().positive().default(10000),
});

const BackendSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.number().int().positive().default(3001),
  // CLI-only configs (e.g. onchain-novel-cli setup) omit this section; backend
  // runtime still needs a real URL, but the placeholder here keeps schema
  // validation happy and the backend itself errors later with a clearer message
  // if it tries to connect to a non-existent database.
  databaseUrl: z.string().min(1).default("postgresql://127.0.0.1:5432/onchain_novel"),
  indexer: IndexerSchema.default({}),
  keeper: KeeperSchema.default({}),
});

const FrontendSchema = z.object({
  port: z.number().int().positive().default(3000),
  backendUrl: z.string().url().default("http://127.0.0.1:3001"),
  // Extra Next.js dev-server origins allowed for HMR etc. Empty = same-origin only.
  allowedDevOrigins: z.array(z.string()).default([]),
});

const CliSchema = z.object({
  apiUrl: z.string().url().default("http://127.0.0.1:3001"),
});

export const AppConfigSchema = z.object({
  chain: ChainSchema,
  contracts: ContractsSchema.default({}),
  backend: BackendSchema.default({}),
  frontend: FrontendSchema.default({}),
  cli: CliSchema.default({}),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

// ────────────────────────────────────────────────────────────────────────────
// Loader
// ────────────────────────────────────────────────────────────────────────────

function findRepoRoot(startDir: string): string {
  // Walk up until we find a directory containing config.yaml OR foundry.toml
  // (our repo's anchors). Stops at filesystem root.
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, "config.yaml")) || existsSync(join(dir, "foundry.toml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not find repo root from ${startDir} — no config.yaml or foundry.toml anchor found.`,
      );
    }
    dir = parent;
  }
}

/** Deep-merge two plain objects. Arrays are replaced, not concatenated. */
function deepMerge<T>(base: T, overlay: Partial<T>): T {
  if (overlay === undefined || overlay === null) return base;
  if (typeof base !== "object" || typeof overlay !== "object" || Array.isArray(overlay)) {
    return overlay as T;
  }
  const out = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(overlay as Record<string, unknown>)) {
    if (v === undefined) continue;
    const baseVal = out[k];
    if (
      typeof v === "object" &&
      v !== null &&
      !Array.isArray(v) &&
      typeof baseVal === "object" &&
      baseVal !== null &&
      !Array.isArray(baseVal)
    ) {
      out[k] = deepMerge(baseVal, v as Partial<typeof baseVal>);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

function readYaml(path: string): Record<string, unknown> {
  const raw = readFileSync(path, "utf-8");
  const parsed = YAML.parse(raw);
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected YAML object at top level of ${path}`);
  }
  return parsed as Record<string, unknown>;
}

export interface LoadConfigOptions {
  /** Override the config.yaml path. Default: auto-discover repo root. */
  configPath?: string;
  /** Starting dir for repo-root discovery. Default: process.cwd(). */
  searchFrom?: string;
}

/**
 * Resolve the full config:
 *   1. Read <repo>/config.yaml (required).
 *   2. Deep-merge <repo>/config.local.yaml if present.
 *   3. Validate with Zod.
 *
 * Secret env vars (PRIVATE_KEY, KEEPER_PRIVATE_KEY, VOTE_ENCRYPTION_KEY,
 * DATABASE_URL) are NOT part of AppConfig — read them directly from process.env
 * at the call site. This keeps the config file safe to commit.
 */
export function loadConfig(opts: LoadConfigOptions = {}): AppConfig {
  const searchFrom = opts.searchFrom ?? process.cwd();
  const explicitPath = opts.configPath ?? process.env.ONCHAIN_NOVEL_CONFIG;

  let mainPath: string;
  let root: string;
  if (explicitPath) {
    mainPath = resolve(explicitPath);
    root = dirname(mainPath);
  } else {
    root = findRepoRoot(searchFrom);
    mainPath = join(root, "config.yaml");
  }

  if (!existsSync(mainPath)) {
    throw new Error(`config.yaml not found at ${mainPath}`);
  }
  let merged = readYaml(mainPath);

  const localPath = join(root, "config.local.yaml");
  if (existsSync(localPath)) {
    merged = deepMerge(merged, readYaml(localPath));
  }

  // DATABASE_URL is the one non-secret env override we allow to survive —
  // because it commonly carries a password and the pattern of composing it via
  // env (from CI or docker-compose) is universal.
  if (process.env.DATABASE_URL) {
    merged = deepMerge(merged, { backend: { databaseUrl: process.env.DATABASE_URL } });
  }

  const result = AppConfigSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid config (${mainPath}):\n${issues}`);
  }
  return result.data;
}

// ────────────────────────────────────────────────────────────────────────────
// Secrets helper (env-only, never in config files)
// ────────────────────────────────────────────────────────────────────────────

export function getPrivateKey(): `0x${string}` | null {
  const pk = process.env.PRIVATE_KEY?.trim();
  if (!pk) return null;
  return (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`;
}

export function getKeeperPrivateKey(): `0x${string}` | null {
  const pk = process.env.KEEPER_PRIVATE_KEY?.trim();
  if (!pk) return null;
  return (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`;
}

export function getVoteEncryptionKey(): string | null {
  return process.env.VOTE_ENCRYPTION_KEY?.trim() || null;
}

// Re-export hexAddress helper in case consumers need it for their own schemas
export { hexAddress };

// ────────────────────────────────────────────────────────────────────────────
// Bootstrap (config + on-chain resolution in one call)
// ────────────────────────────────────────────────────────────────────────────

import { createPublicClient, http, type Address } from "viem";

import { resolveContracts, type ResolvedContracts } from "./chain/resolveContracts.js";

export interface BootstrappedConfig {
  config: AppConfig;
  chainId: number;
  contracts: ResolvedContracts;
}

/**
 * One-shot startup bootstrap for any service that needs the full deployment:
 *   1. Load + validate config.yaml (sync).
 *   2. If chain.chainId is unset, query the RPC's eth_chainId.
 *   3. Walk NovelCore's address book to resolve the other 6 contract addresses.
 *
 * Returns a frozen view; callers should hold this for the process lifetime
 * (addresses change only on redeploy / setter-call). Throws if the RPC is
 * unreachable or `contracts.novelCore` is missing.
 */
export async function bootstrapConfig(opts: LoadConfigOptions = {}): Promise<BootstrappedConfig> {
  const config = loadConfig(opts);
  if (!config.contracts.novelCore) {
    throw new Error(
      "Missing contracts.novelCore in config.yaml. Run scripts/deploy.sh, then patch-config.ts will fill it in.",
    );
  }
  const client = createPublicClient({ transport: http(config.chain.rpcUrl) });
  const [chainId, contracts] = await Promise.all([
    config.chain.chainId !== undefined
      ? Promise.resolve(config.chain.chainId)
      : client.getChainId(),
    resolveContracts({ novelCore: config.contracts.novelCore as Address, client }),
  ]);
  return { config, chainId, contracts };
}
