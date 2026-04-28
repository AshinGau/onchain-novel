// Single source of truth for the chain object the frontend talks to. Built
// from build-time env vars baked by next.config.ts (which calls bootstrapConfig
// to load config.yaml + auto-detect chainId via eth_chainId).
//
// We always define the chain dynamically rather than looking up viem's
// built-in presets — `chain.blockExplorers` would only be used by RainbowKit
// for "View on Explorer" links, and the protocol doesn't ship that. If you
// later want explorer links, add `chain.explorerUrl` to config.yaml.
//
// Both lib/wagmi-config.ts and lib/config.ts import from here, so the chain
// object and TOKEN_SYMBOL can never drift apart.
import { defineChain } from "viem";

export const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL as string;
export const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID);

export const chain = defineChain({
  id: chainId,
  name: `Chain ${chainId}`,
  nativeCurrency: {
    name: process.env.NEXT_PUBLIC_NATIVE_NAME as string,
    symbol: process.env.NEXT_PUBLIC_NATIVE_SYMBOL as string,
    decimals: Number(process.env.NEXT_PUBLIC_NATIVE_DECIMALS),
  },
  rpcUrls: { default: { http: [rpcUrl] } },
});
