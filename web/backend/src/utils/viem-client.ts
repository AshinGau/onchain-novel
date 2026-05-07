import {
  type Chain,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import { env } from "./env.js";

// Single chain object built from config.yaml. Backend never reads
// chain.blockExplorers / chain.name, so we don't bother looking up viem's
// built-in presets — defineChain works for any EVM network.
export const chain: Chain = defineChain({
  id: env.CHAIN_ID,
  name: `Chain ${env.CHAIN_ID}`,
  nativeCurrency: {
    name: env.NATIVE_NAME,
    symbol: env.NATIVE_SYMBOL,
    decimals: env.NATIVE_DECIMALS,
  },
  rpcUrls: { default: { http: [env.RPC_URL] } },
});

export function createRpcPublicClient(rpcUrl: string = env.RPC_URL): PublicClient {
  return createPublicClient({ chain, transport: http(rpcUrl) }) as PublicClient;
}

export function createKeeperClients(): {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: PrivateKeyAccount;
} {
  const transport = http(env.RPC_URL);
  const publicClient = createPublicClient({ chain, transport }) as PublicClient;
  const account = privateKeyToAccount(env.KEEPER_PRIVATE_KEY);
  const walletClient = createWalletClient({ chain, transport, account });
  return { publicClient, walletClient, account };
}

export function createFaucetClients(): {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: PrivateKeyAccount;
} {
  const transport = http(env.RPC_URL);
  const publicClient = createPublicClient({ chain, transport }) as PublicClient;
  const account = privateKeyToAccount(env.FAUCET_PRIVATE_KEY);
  const walletClient = createWalletClient({ chain, transport, account });
  return { publicClient, walletClient, account };
}
