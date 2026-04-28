import { createPublicClient, createWalletClient, defineChain, http, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { getPrivateKey, requireConfig } from "./config.js";

function getChain() {
  const config = requireConfig();
  return defineChain({
    id: config.chainId,
    name: `Chain ${config.chainId}`,
    nativeCurrency: config.nativeCurrency,
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
}

export function getPublicClient() {
  const config = requireConfig();
  return createPublicClient({
    chain: getChain(),
    transport: http(config.rpcUrl),
  });
}

export function getWalletClient() {
  const config = requireConfig();
  const pk = getPrivateKey();
  if (!pk) {
    console.error(
      "PRIVATE_KEY env var not set. The CLI never persists secrets; export it in your shell:\n" +
        "  export PRIVATE_KEY=0x...\n" +
        "Or inject it with a secret manager (direnv, 1Password CLI, etc).",
    );
    process.exit(1);
  }
  const account = privateKeyToAccount(pk);
  return createWalletClient({
    account,
    chain: getChain(),
    transport: http(config.rpcUrl),
  });
}

export function getContracts() {
  const config = requireConfig();
  return config.contracts;
}

/** Wait for a transaction receipt; throws if reverted. */
export async function waitForTx(hash: Hash): Promise<void> {
  const client = getPublicClient();
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Transaction ${hash} reverted`);
  }
}
