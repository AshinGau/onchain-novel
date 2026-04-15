import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

import { config } from "../config.js";

function getChain() {
  if (!config.chainId || config.chainId === foundry.id) return foundry;
  return defineChain({
    id: config.chainId,
    name: `Chain ${config.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
}

export function getPublicClient() {
  return createPublicClient({
    chain: getChain(),
    transport: http(config.rpcUrl),
  });
}

export function getWalletClient() {
  if (!config.privateKey) {
    throw new Error("PRIVATE_KEY env var is not set");
  }
  const account = privateKeyToAccount(config.privateKey);
  return createWalletClient({
    account,
    chain: getChain(),
    transport: http(config.rpcUrl),
  });
}
