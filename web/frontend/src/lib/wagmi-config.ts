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
import { base, foundry, mainnet, sepolia } from "wagmi/chains";

// Both NEXT_PUBLIC_RPC_URL and NEXT_PUBLIC_CHAIN_ID are populated at build
// time by next.config.ts (which calls bootstrapConfig). If the build couldn't
// resolve them, it would have failed before reaching here.
export const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL as string;
const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID);

// injectedWallet auto-detects MetaMask, Rabby, and any other EIP-1193 wallet
// available at window.ethereum. metaMaskWallet / rainbowWallet from the
// rainbowkit wallet list still pull in WalletConnect as a fallback, so we
// stick to the pure-injected entry. projectId is required by the type but
// unused when no WC-backed wallet is registered.
const connectors = connectorsForWallets(
  [{ groupName: "Recommended", wallets: [injectedWallet] }],
  { appName: "Onchain Novel", projectId: "onchain-novel-local" },
);

// Single-chain wagmi config keyed off the build-time chainId. Each branch is
// typed with a concrete chain tuple so wagmi's transports key requirement is
// satisfied without declaring an unused chain (which would make RainbowKit
// show a spurious network switcher + let users accidentally send local-dev
// txs to the wrong chain). New chain support = add another branch.
function buildWagmiConfig() {
  switch (chainId) {
    case foundry.id:
      return {
        chain: foundry,
        wagmiConfig: createConfig({
          chains: [foundry],
          transports: { [foundry.id]: http(rpcUrl) },
          connectors,
          ssr: true,
        }),
      };
    case base.id:
      return {
        chain: base,
        wagmiConfig: createConfig({
          chains: [base],
          transports: { [base.id]: http(rpcUrl) },
          connectors,
          ssr: true,
        }),
      };
    case mainnet.id:
      return {
        chain: mainnet,
        wagmiConfig: createConfig({
          chains: [mainnet],
          transports: { [mainnet.id]: http(rpcUrl) },
          connectors,
          ssr: true,
        }),
      };
    case sepolia.id:
      return {
        chain: sepolia,
        wagmiConfig: createConfig({
          chains: [sepolia],
          transports: { [sepolia.id]: http(rpcUrl) },
          connectors,
          ssr: true,
        }),
      };
    default:
      throw new Error(`Unsupported chainId: ${chainId}`);
  }
}

export const { chain, wagmiConfig } = buildWagmiConfig();
