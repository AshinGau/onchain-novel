#!/usr/bin/env node
/**
 * Read the most recent forge broadcast + deploy log and write the resulting
 * proxy addresses back into config.yaml. Run after `forge script Deploy.s.sol`.
 *
 * Usage:
 *   npx tsx scripts/patch-config.ts [--chain-id 31337]
 *   npx tsx scripts/patch-config.ts --log /tmp/deploy.log
 *
 * The deploy script prints lines like:
 *     NovelCore: 0xabc...
 *     RoundManager: 0xabc...
 *     ...
 * The simplest reliable source of truth is therefore a deploy log file. If no
 * --log is given we try `broadcast/Deploy.s.sol/<chainId>/run-latest.json` and
 * infer addresses from the transaction order (less robust).
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

// Match "    NovelCore:            0xabc..." style lines printed by the deploy script's console.log
const ADDRESS_RE = /^\s*([A-Za-z]+):\s*(0x[0-9a-fA-F]{40})\s*$/;

const NAME_TO_KEY: Record<string, keyof Contracts> = {
  NovelCore: "novelCore",
  RoundManager: "roundManager",
  VotingEngine: "votingEngine",
  PrizePool: "prizePool",
  RulesEngine: "rulesEngine",
  BountyBoard: "bountyBoard",
  UserRegistry: "userRegistry",
};

interface Contracts {
  novelCore?: string;
  roundManager?: string;
  votingEngine?: string;
  prizePool?: string;
  bountyBoard?: string;
  rulesEngine?: string;
  userRegistry?: string;
}

function parseLogForAddresses(logText: string): Contracts {
  const contracts: Contracts = {};
  for (const line of logText.split("\n")) {
    const m = line.match(ADDRESS_RE);
    if (!m) continue;
    const [, name, address] = m;
    const key = NAME_TO_KEY[name];
    if (key) contracts[key] = address;
  }
  return contracts;
}

function extractFromBroadcastJson(broadcastPath: string): Contracts {
  // Fallback: the broadcast JSON doesn't carry role names, but the proxy
  // creation order is stable (see scripts/Deploy.s.sol). We pick the last 6
  // CREATE transactions (the 6 proxies), then the final UserRegistry CREATE.
  // Impl contracts come first, proxies come next, in this order:
  //   impl: NovelCore, VotingEngine, PrizePool, RulesEngine, BountyBoard, RoundManager
  //   proxy: Voting, Prize, Rules, NovelCore, Bounty, Round
  //   standalone: UserRegistry
  const data = JSON.parse(readFileSync(broadcastPath, "utf-8"));
  const creates: { contractAddress: string }[] = (data.transactions ?? []).filter(
    (t: { transactionType: string }) => t.transactionType === "CREATE",
  );
  if (creates.length < 13) {
    throw new Error(
      `Broadcast file has ${creates.length} CREATE transactions; expected ≥13. Falling back — please use --log for reliable mapping.`,
    );
  }
  return {
    votingEngine: creates[6].contractAddress,
    prizePool: creates[7].contractAddress,
    rulesEngine: creates[8].contractAddress,
    novelCore: creates[9].contractAddress,
    bountyBoard: creates[10].contractAddress,
    roundManager: creates[11].contractAddress,
    userRegistry: creates[12].contractAddress,
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const root = findRepoRoot(process.cwd());
  const configPath = args.config ? resolve(args.config) : join(root, "config.yaml");
  const chainId = args["chain-id"] ?? "31337";

  let contracts: Contracts;
  if (args.log) {
    const logText = readFileSync(resolve(args.log), "utf-8");
    contracts = parseLogForAddresses(logText);
    if (Object.keys(contracts).length === 0) {
      console.error("No addresses matched in log. Expected lines like 'NovelCore: 0x...'.");
      process.exit(1);
    }
  } else {
    const broadcastPath = join(
      root,
      "broadcast",
      "Deploy.s.sol",
      chainId,
      "run-latest.json",
    );
    if (!existsSync(broadcastPath)) {
      console.error(`Broadcast file not found: ${broadcastPath}`);
      console.error("Pass --log /path/to/deploy.log instead, or run forge script Deploy first.");
      process.exit(1);
    }
    contracts = extractFromBroadcastJson(broadcastPath);
  }

  const raw = readFileSync(configPath, "utf-8");
  const doc = YAML.parseDocument(raw);
  const cur = (doc.get("contracts") as YAML.YAMLMap<string, string>) ?? new YAML.YAMLMap();
  for (const [key, value] of Object.entries(contracts)) {
    if (value) doc.setIn(["contracts", key], value);
  }

  writeFileSync(configPath, doc.toString());
  console.log(`Updated ${configPath}:`);
  for (const [key, value] of Object.entries(contracts)) {
    if (value) console.log(`  contracts.${key} = ${value}`);
  }
  void cur;
}

main();
