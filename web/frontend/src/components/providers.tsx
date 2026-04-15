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
  const [mode, setMode] = useState<"dark" | "light">("dark");

  useEffect(() => {
    // Read initial theme
    const stored = localStorage.getItem("theme");
    if (stored === "light") setMode("light");

    // Watch for changes (theme-toggle mutates classList + data-theme)
    const observer = new MutationObserver(() => {
      const isDark = document.documentElement.classList.contains("dark");
      setMode(isDark ? "dark" : "light");
    });
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
