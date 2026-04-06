import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Transport,
  type Chain,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { config } from "../config.js";

/**
 * Get the chain configuration.
 * Defaults to Foundry/Anvil local chain. Override via RPC_URL env var.
 */
function getChain(): Chain {
  return foundry;
}

/**
 * Create a public client for read-only contract calls.
 */
export function getPublicClient(): PublicClient<Transport, Chain> {
  return createPublicClient({
    chain: getChain(),
    transport: http(config.rpcUrl),
  }) as PublicClient<Transport, Chain>;
}

/**
 * Create a wallet client for sending transactions.
 * Requires PRIVATE_KEY env var to be set.
 */
export function getWalletClient(): WalletClient<Transport, Chain, Account> {
  if (!config.privateKey) {
    throw new Error("PRIVATE_KEY environment variable is not set");
  }
  const account = privateKeyToAccount(config.privateKey);
  return createWalletClient({
    account,
    chain: getChain(),
    transport: http(config.rpcUrl),
  }) as WalletClient<Transport, Chain, Account>;
}

/**
 * Get the address of the configured wallet.
 */
export function getWalletAddress(): `0x${string}` {
  if (!config.privateKey) {
    throw new Error("PRIVATE_KEY environment variable is not set");
  }
  const account = privateKeyToAccount(config.privateKey);
  return account.address;
}
