import { createPublicClient, createWalletClient, http, type Chain, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { foundry, mainnet, sepolia } from "viem/chains";

import { env } from "./env.js";

const CHAINS_BY_ID: Record<number, Chain> = {
  [foundry.id]: foundry,
  [mainnet.id]: mainnet,
  [sepolia.id]: sepolia,
};

export function resolveChain(): Chain {
  const chain = CHAINS_BY_ID[env.CHAIN_ID];
  if (!chain) throw new Error(`Unsupported chainId: ${env.CHAIN_ID}`);
  return chain;
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
