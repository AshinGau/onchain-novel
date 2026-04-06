"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { NotificationBell } from "@/components/notification-bell";

function NavSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function submit() {
    const q = query.trim();
    if (q) {
      router.push(`/?search=${encodeURIComponent(q)}`);
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div className="relative flex items-center">
      <div
        className={`flex items-center overflow-hidden transition-all duration-200 rounded-full border ${
          open
            ? "w-52 border-neutral-600 bg-neutral-900"
            : "w-8 h-8 border-transparent hover:border-neutral-700 cursor-pointer bg-neutral-900/50"
        }`}
      >
        <button
          onClick={() => { if (!open) setOpen(true); else submit(); }}
          className="flex-shrink-0 flex items-center justify-center w-8 h-8 text-neutral-400 hover:text-white"
          aria-label="Search"
        >
          <Search size={15} />
        </button>
        {open && (
          <>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") { setOpen(false); setQuery(""); } }}
              placeholder="Title, ID, or address"
              className="flex-1 bg-transparent text-sm text-white placeholder-neutral-500 outline-none pr-1"
            />
            <button
              onClick={() => { setOpen(false); setQuery(""); }}
              className="flex-shrink-0 flex items-center justify-center w-7 h-8 text-neutral-500 hover:text-white"
            >
              <X size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

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
          <Link href="/create" className={pathname === "/create" ? "text-white" : "text-neutral-400 hover:text-white"}>
            Create Novel
          </Link>
          <Link href="/dashboard" className={pathname === "/dashboard" ? "text-white" : "text-neutral-400 hover:text-white"}>
            My Dashboard
          </Link>
          <NavSearch />
          <NotificationBell />
          <ConnectButton showBalance={false} chainStatus="icon" accountStatus="avatar" />
        </nav>
      </header>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-neutral-800 bg-neutral-950 py-2">
        <Link href="/" className={`flex flex-col items-center text-xs ${pathname === "/" ? "text-white" : "text-neutral-500"}`}>
          <span className="text-lg">📖</span>
          <span>Discover</span>
        </Link>
        <Link href="/create" className={`flex flex-col items-center text-xs ${pathname === "/create" ? "text-white" : "text-neutral-500"}`}>
          <span className="text-lg">✍️</span>
          <span>Create</span>
        </Link>
        <Link href="/dashboard" className={`flex flex-col items-center text-xs ${pathname === "/dashboard" ? "text-white" : "text-neutral-500"}`}>
          <span className="text-lg">👤</span>
          <span>Me</span>
        </Link>
      </nav>
    </>
  );
}
