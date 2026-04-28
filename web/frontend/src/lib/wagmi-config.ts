// Local-dev wallet wiring: injected connectors only (MetaMask extension, Rabby,
// any window.ethereum provider). WalletConnect is intentionally excluded —
// pulling it in loads Reown's AppKit, which hits api.web3modal.org at init
// time; without a real WalletConnect projectId that fetch 403s, Turbopack's
// dev bundler gets wedged on the ESM init, and every component that depends
// on the WagmiProvider context ends up without a handler mounted.
//
// If/when this app needs mobile-wallet support via QR scan, set a real
// WALLETCONNECT projectId in config.yaml and swap this file back to
// getDefaultConfig — but don't do it for local dev.
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";

import { chain, rpcUrl } from "./chain";

// injectedWallet auto-detects MetaMask, Rabby, and any other EIP-1193 wallet
// available at window.ethereum. metaMaskWallet / rainbowWallet from the
// rainbowkit wallet list still pull in WalletConnect as a fallback, so we
// stick to the pure-injected entry. projectId is required by the type but
// unused when no WC-backed wallet is registered.
const connectors = connectorsForWallets(
  [{ groupName: "Recommended", wallets: [injectedWallet] }],
  { appName: "Onchain Novel", projectId: "onchain-novel-local" },
);

// Single-chain wagmi config — `chains` always has exactly one entry, so
// RainbowKit doesn't render a network switcher and users can't accidentally
// send local-dev txs to the wrong network. Add multi-chain support only if
// the protocol is actually deployed on multiple chains simultaneously.
export const wagmiConfig = createConfig({
  chains: [chain],
  transports: { [chain.id]: http(rpcUrl) },
  connectors,
  ssr: true,
});
