#!/usr/bin/env node
/**
 * Read the most recent forge broadcast + deploy log and write the resulting
 * NovelCore proxy address back into config.yaml. Run after `forge script Deploy.s.sol`.
 *
 * Only `contracts.novelCore` is written. Every other contract address is
 * derivable on-chain via NovelCore's address book (see
 * packages/shared/src/chain/resolveContracts.ts) and resolved at runtime.
 *
 * Usage:
 *   npx tsx scripts/patch-config.ts [--chain-id 31337]
 *   npx tsx scripts/patch-config.ts --log /tmp/deploy.log
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import YAML from "yaml";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

function findRepoRoot(startDir: string): string {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, "config.yaml")) || existsSync(join(dir, "foundry.toml"))) {
      return dir;
    }
    const parent = dir.split("/").slice(0, -1).join("/");
    if (parent === dir || parent === "") {
      throw new Error(`Could not find repo root from ${startDir}`);
    }
    dir = parent;
  }
}

// Match "    NovelCore: 0xabc..." — the deploy script's console.log format.
const ADDRESS_RE = /^\s*NovelCore:\s*(0x[0-9a-fA-F]{40})\s*$/;

function parseLogForNovelCore(logText: string): string | null {
  for (const line of logText.split("\n")) {
    const m = line.match(ADDRESS_RE);
    if (m) return m[1];
  }
  return null;
}

function extractFromBroadcastJson(broadcastPath: string): string {
  // Broadcast JSON doesn't carry role names, but proxy creation order is fixed.
  // Order produced by scripts/Deploy.s.sol:
  //   impls (6): NovelCore, VotingEngine, PrizePool, RulesEngine, BountyBoard, RoundManager
  //   userRegistry standalone (1): #6
  //   proxies (6): voting #7, prize #8, rules #9, novelCore #10, bounty #11, round #12
  // → NovelCore proxy is index 10.
  const data = JSON.parse(readFileSync(broadcastPath, "utf-8"));
  const creates: { contractAddress: string }[] = (data.transactions ?? []).filter(
    (t: { transactionType: string }) => t.transactionType === "CREATE",
  );
  if (creates.length < 13) {
    throw new Error(
      `Broadcast file has ${creates.length} CREATE transactions; expected ≥13. Pass --log instead.`,
    );
  }
  return creates[10].contractAddress;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const root = findRepoRoot(process.cwd());
  const configPath = args.config ? resolve(args.config) : join(root, "config.yaml");
  const chainId = args["chain-id"] ?? "31337";

  let novelCore: string | null;
  if (args.log) {
    const logText = readFileSync(resolve(args.log), "utf-8");
    novelCore = parseLogForNovelCore(logText);
    if (!novelCore) {
      console.error("No NovelCore address matched in log. Expected a line like 'NovelCore: 0x...'.");
      process.exit(1);
    }
  } else {
    const broadcastPath = join(root, "broadcast", "Deploy.s.sol", chainId, "run-latest.json");
    if (!existsSync(broadcastPath)) {
      console.error(`Broadcast file not found: ${broadcastPath}`);
      console.error("Pass --log /path/to/deploy.log instead, or run forge script Deploy first.");
      process.exit(1);
    }
    novelCore = extractFromBroadcastJson(broadcastPath);
  }

  const raw = readFileSync(configPath, "utf-8");
  const doc = YAML.parseDocument(raw);
  doc.setIn(["contracts", "novelCore"], novelCore);

  writeFileSync(configPath, doc.toString());
  console.log(`Updated ${configPath}:`);
  console.log(`  contracts.novelCore = ${novelCore}`);
}

main();
