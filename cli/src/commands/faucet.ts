import { Command } from "commander";
import { isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { apiPost } from "../utils/api.js";
import { getPrivateKey } from "../utils/config.js";
import { error, header, kv, success, txHash } from "../utils/format.js";

interface ClaimResult {
  txHash?: `0x${string}`;
  amount?: string;
  symbol?: string;
  to?: string;
  error?: string;
  nextResetMs?: number;
}

function resolveSelfAddress(): `0x${string}` {
  const pk = getPrivateKey();
  if (!pk) {
    error(
      "No --address given and PRIVATE_KEY env not set. " +
        "Either pass --address 0x... or export PRIVATE_KEY.",
    );
    process.exit(1);
  }
  return privateKeyToAccount(pk).address;
}

function formatHms(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}h${m}m${s}s`;
}

export function registerFaucetCommands(program: Command): void {
  const faucet = program
    .command("faucet")
    .description("Testnet faucet — claim native tokens to fund chain commands");

  faucet
    .command("claim")
    .description(
      "Claim 10 native tokens from the backend faucet. " +
        "One claim per address per local day. Defaults to the PRIVATE_KEY wallet.",
    )
    .option("--address <addr>", "address to fund (defaults to PRIVATE_KEY wallet)")
    .action(async (opts: { address?: string }) => {
      try {
        let target: `0x${string}`;
        if (opts.address) {
          if (!isAddress(opts.address)) {
            error(`Not a valid address: ${opts.address}`);
            process.exit(1);
          }
          target = opts.address;
        } else {
          target = resolveSelfAddress();
        }

        header("Faucet — claim");
        kv("Address", target);

        const { status, body } = await apiPost<ClaimResult>("/api/faucet/claim", {
          address: target,
        });

        if (body?.txHash) {
          txHash(body.txHash);
          success(`Sent ${body.amount} ${body.symbol} to ${body.to}`);
          return;
        }

        const msg = body?.error ?? `HTTP ${status}`;
        error(
          status === 429 && body?.nextResetMs
            ? `${msg} (resets in ${formatHms(body.nextResetMs)})`
            : msg,
        );
        process.exit(1);
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });
}
