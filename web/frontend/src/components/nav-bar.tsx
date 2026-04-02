"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";

export function NavBar() {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop nav */}
      <header className="hidden md:flex items-center justify-between border-b border-neutral-800 px-6 py-3">
        <Link href="/" className="text-lg font-bold tracking-tight">
          Onchain Novel
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/" className={pathname === "/" ? "text-white" : "text-neutral-400 hover:text-white"}>
            Discover
          </Link>
          <Link href="/dashboard" className={pathname === "/dashboard" ? "text-white" : "text-neutral-400 hover:text-white"}>
            My Dashboard
          </Link>
          <ConnectButton showBalance={false} chainStatus="icon" accountStatus="avatar" />
        </nav>
      </header>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-neutral-800 bg-neutral-950 py-2">
        <Link href="/" className={`flex flex-col items-center text-xs ${pathname === "/" ? "text-white" : "text-neutral-500"}`}>
          <span className="text-lg">📖</span>
          <span>Discover</span>
        </Link>
        <button className="flex flex-col items-center text-xs text-neutral-500" onClick={() => alert("Coming Soon")}>
          <span className="text-lg">🗳️</span>
          <span>Vote</span>
        </button>
        <button className="flex flex-col items-center text-xs text-neutral-500" onClick={() => alert("Coming Soon")}>
          <span className="text-lg">✍️</span>
          <span>Write</span>
        </button>
        <Link href="/dashboard" className={`flex flex-col items-center text-xs ${pathname === "/dashboard" ? "text-white" : "text-neutral-500"}`}>
          <span className="text-lg">👤</span>
          <span>Me</span>
        </Link>
      </nav>
    </>
  );
}
