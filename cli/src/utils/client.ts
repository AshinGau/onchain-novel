import { createPublicClient, createWalletClient, defineChain, http, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { requireConfig } from "./config.js";

function getChain() {
  const config = requireConfig();
  if (!config.chainId || config.chainId === foundry.id) return foundry;
  return defineChain({
    id: config.chainId,
    name: `Chain ${config.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
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
  if (!config.privateKey) {
    console.error("No privateKey in config. Run 'onchain-novel-cli config set privateKey <key>'.");
    process.exit(1);
  }
  const account = privateKeyToAccount(config.privateKey as `0x${string}`);
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
