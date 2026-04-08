"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Menu, X } from "lucide-react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Button } from "@/components/ui/button";

const NAV_LINKS = [
  { href: "/novels", label: "Novels" },
] as const;

export function NavBar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <header className="on-row" style={{
        justifyContent: "space-between",
        borderBottom: "1px solid var(--color-border)",
        padding: "0.75rem 1.5rem",
        background: "var(--color-bg)",
      }}>
        {/* Logo */}
        <Link href="/novels" className="on-row" style={{ gap: "0.5rem", textDecoration: "none" }}>
          <BookOpen size={20} style={{ color: "var(--color-primary)" }} />
          <span className="text-subheading" style={{ fontSize: "1.125rem" }}>
            Onchain Novel
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="on-row" style={{ gap: "1.5rem", display: "var(--desktop-nav, flex)" }}>
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={pathname.startsWith(link.href) ? "text-body" : "text-caption"}
              style={{ textDecoration: "none", fontWeight: 500 }}
            >
              {link.label}
            </Link>
          ))}
          <ThemeToggle />
          <ConnectButton showBalance={false} chainStatus="icon" accountStatus="avatar" />
        </nav>

        {/* Mobile hamburger */}
        <div className="mobile-menu-toggle">
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </Button>
        </div>
      </header>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="mobile-menu-dropdown" style={{
          background: "var(--color-bg)",
          borderBottom: "1px solid var(--color-border)",
          padding: "1rem 1.5rem",
        }}>
          <div className="on-stack" style={{ gap: "0.75rem" }}>
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-body"
                style={{ textDecoration: "none" }}
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <div className="on-row" style={{ gap: "0.5rem" }}>
              <ThemeToggle />
              <ConnectButton showBalance={false} chainStatus="icon" accountStatus="avatar" />
            </div>
          </div>
        </div>
      )}

      <style>{`
        .mobile-menu-toggle { display: none; }
        .mobile-menu-dropdown { display: block; }
        @media (min-width: 768px) {
          .mobile-menu-toggle { display: none !important; }
          .mobile-menu-dropdown { display: none !important; }
        }
        @media (max-width: 767px) {
          .mobile-menu-toggle { display: block; }
          nav.on-row { display: none !important; }
        }
      `}</style>
    </>
  );
}
