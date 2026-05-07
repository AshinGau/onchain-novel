import { Router } from "express";
import { isAddress, parseUnits, type PublicClient, type WalletClient } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

import { env } from "../utils/env.js";
import { createLogger } from "../utils/logger.js";
import { createFaucetClients } from "../utils/viem-client.js";

const log = createLogger("api:faucet");
const router = Router();

// Use NATIVE_DECIMALS from config so the value is correct on chains where
// native isn't 18-decimal (parseEther would silently misalign).
const CLAIM_AMOUNT = parseUnits("10", env.NATIVE_DECIMALS);

// In-memory daily ledger of claimed addresses (lowercase hex). Cleared at
// local midnight. Dev-only — losing the ledger across restarts is acceptable
// for a testnet faucet behind a known key.
const claimedToday = new Set<string>();

// Cached at startup so each request reuses one transport instead of building
// fresh clients per call. Null when the faucet is disabled / misconfigured.
let clients: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: PrivateKeyAccount;
} | null = null;

function msUntilNextLocalMidnight(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return next.getTime() - now.getTime();
}

// Recursive setTimeout instead of setInterval(24h) — recomputes the delay each
// fire, so we never drift across DST or accumulated event-loop lag.
function scheduleDailyReset(): void {
  setTimeout(() => {
    claimedToday.clear();
    log.info("Faucet daily ledger cleared");
    scheduleDailyReset();
  }, msUntilNextLocalMidnight());
}

export function startFaucet(): void {
  if (!env.FAUCET_PRIVATE_KEY) {
    log.warn("FAUCET_PRIVATE_KEY not set -- POST /api/faucet/claim returns 503");
    return;
  }
  try {
    clients = createFaucetClients();
  } catch (err) {
    log.error({ err }, "Invalid FAUCET_PRIVATE_KEY -- faucet disabled");
    return;
  }
  log.info({ address: clients.account.address, amount: "10" }, "Faucet enabled");
  scheduleDailyReset();
}

router.post("/claim", async (req, res) => {
  if (!clients) {
    res.status(503).json({ error: "faucet disabled" });
    return;
  }

  const raw = req.body?.address;
  if (typeof raw !== "string" || !isAddress(raw.trim())) {
    res.status(400).json({ error: "address must be a 0x-prefixed 20-byte hex" });
    return;
  }
  const addr = raw.trim().toLowerCase() as `0x${string}`;

  // Reserve the slot synchronously *before* any await — Node's single-threaded
  // event loop guarantees no other request can sneak in between has() and
  // add(). Releasing on failure below.
  if (claimedToday.has(addr)) {
    res.status(429).json({
      error: "already claimed today",
      nextResetMs: msUntilNextLocalMidnight(),
    });
    return;
  }
  claimedToday.add(addr);

  try {
    const { publicClient, walletClient, account } = clients;
    const balance = await publicClient.getBalance({ address: account.address });
    if (balance < CLAIM_AMOUNT) {
      claimedToday.delete(addr);
      log.error({ balance: balance.toString() }, "Faucet wallet drained");
      res.status(503).json({ error: "faucet drained" });
      return;
    }

    const txHash = await walletClient.sendTransaction({
      account,
      chain: walletClient.chain,
      to: addr,
      value: CLAIM_AMOUNT,
    });

    log.info({ to: addr, txHash }, "Faucet claim sent");
    res.json({ txHash, amount: "10", symbol: env.NATIVE_SYMBOL, to: addr });
  } catch (err) {
    claimedToday.delete(addr);
    log.error({ err }, "Faucet claim failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
