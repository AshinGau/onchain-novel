import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import { base, foundry } from "wagmi/chains";

const chain = process.env.NEXT_PUBLIC_CHAIN === "base" ? base : foundry;

export const wagmiConfig = getDefaultConfig({
  appName: "Onchain Novel",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_ID || "placeholder",
  chains: [chain],
  transports: {
    [chain.id]: http(process.env.NEXT_PUBLIC_RPC_URL || "http://localhost:8545"),
  },
});
