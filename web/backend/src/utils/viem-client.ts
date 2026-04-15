import { createPublicClient, createWalletClient, http, type Chain, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { anvil, foundry, mainnet, sepolia } from "viem/chains";

import { env } from "./env.js";

const CHAINS: Record<string, Chain> = {
  foundry,
  anvil,
  mainnet,
  sepolia,
};

export function resolveChain(): Chain {
  const name = (process.env.CHAIN_NAME ?? "foundry").toLowerCase();
  return CHAINS[name] ?? foundry;
}

export function createRpcPublicClient(rpcUrl: string = env.RPC_URL): PublicClient {
  return createPublicClient({ chain: resolveChain(), transport: http(rpcUrl) }) as PublicClient;
}

export function createKeeperClients(): {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: PrivateKeyAccount;
} {
  const chain = resolveChain();
  const transport = http(env.RPC_URL);
  const publicClient = createPublicClient({ chain, transport }) as PublicClient;
  const account = privateKeyToAccount(env.KEEPER_PRIVATE_KEY);
  const walletClient = createWalletClient({ chain, transport, account });
  return { publicClient, walletClient, account };
}
