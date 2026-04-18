"use client";

import { darkTheme, lightTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { WagmiProvider } from "wagmi";

import { wagmiConfig } from "@/lib/wagmi-config";

import "@rainbow-me/rainbowkit/styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

const rkDark = darkTheme({ accentColor: "#6366f1" });
const rkLight = lightTheme({ accentColor: "#6366f1" });

export function Providers({ children }: { children: React.ReactNode }) {
  // SSR has no DOM — pick "dark" to match the no-FOUC default. After mount
  // the observer reads the real `.dark` class state (set by the head script)
  // and updates if needed. Worst case: a sub-tick of wrong RainbowKit theme
  // on first paint, but no hydration mismatch.
  const [mode, setMode] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const sync = () => {
      setMode(document.documentElement.classList.contains("dark") ? "dark" : "light");
    };
    sync();
    // Watch for theme-toggle toggling the `.dark` class on <html>.
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={mode === "dark" ? rkDark : rkLight}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
