"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { BookOpen, LayoutDashboard, Menu, Plus, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";

const NAV_LINKS = [
  { href: "/novels", label: "Novels" },
  { href: "/create", label: "Create Novel", icon: Plus },
  { href: "/dashboard", label: "My Dashboard", icon: LayoutDashboard },
] as const;

export function NavBar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <header className="on-nav">
        <Link href="/novels" className="on-nav-brand">
          <BookOpen size={20} />
          <span className="text-subheading">Onchain Novel</span>
        </Link>

        <nav className="on-nav-desktop">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={pathname.startsWith(link.href) ? "text-body" : "text-caption"}
            >
              {link.label}
            </Link>
          ))}
          <ThemeToggle />
          <ConnectButton showBalance={false} chainStatus="icon" accountStatus="avatar" />
        </nav>

        <div className="on-nav-mobile-toggle on-row" style={{ gap: "0.25rem" }}>
          <ThemeToggle />
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </Button>
        </div>
      </header>

      {mobileOpen && (
        <div className="on-nav-mobile-menu">
          <div className="on-stack on-stack-sm">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-body"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <ConnectButton showBalance={false} chainStatus="icon" accountStatus="avatar" />
          </div>
        </div>
      )}
    </>
  );
}
