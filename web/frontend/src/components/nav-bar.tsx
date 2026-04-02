"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
          <button
            className="text-neutral-500 cursor-not-allowed"
            onClick={() => alert("Coming Soon")}
          >
            My Dashboard
          </button>
          <button
            className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700"
            onClick={() => alert("Coming Soon — Wallet connection will be available in a future update.")}
          >
            Connect Wallet
          </button>
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
        <button className="flex flex-col items-center text-xs text-neutral-500" onClick={() => alert("Coming Soon")}>
          <span className="text-lg">👤</span>
          <span>Me</span>
        </button>
      </nav>
    </>
  );
}
