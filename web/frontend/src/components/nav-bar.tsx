"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { NotificationBell } from "@/components/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";

export function NavBar() {
  const pathname = usePathname();

  function navLink(href: string, label: string) {
    const active = pathname === href;
    return (
      <li className="nav-item">
        <Link href={href} className={`nav-link ${active ? "active fw-semibold" : ""}`}>
          {label}
        </Link>
      </li>
    );
  }

  return (
    <>
      {/* Desktop nav */}
      <nav className="navbar navbar-expand-md border-bottom d-none d-md-flex">
        <div className="container-lg">
          <Link href="/" className="navbar-brand fw-bold">Onchain Novel</Link>
          <ul className="navbar-nav me-auto">
            {navLink("/", "Discover")}
            {navLink("/create", "Create Novel")}
            {navLink("/dashboard", "My Dashboard")}
          </ul>
          <div className="d-flex align-items-center gap-2">
            <NotificationBell />
            <ThemeToggle />
            <ConnectButton showBalance={false} chainStatus="icon" accountStatus="avatar" />
          </div>
        </div>
      </nav>

      {/* Mobile bottom tab bar */}
      <nav className="d-md-none fixed-bottom border-top bg-body d-flex justify-content-around py-2" style={{ zIndex: 1030 }}>
        <Link href="/" className={`d-flex flex-column align-items-center small text-decoration-none ${pathname === "/" ? "text-body" : "text-body-secondary"}`}>
          <i className="bi bi-book fs-5" />
          <span>Discover</span>
        </Link>
        <Link href="/create" className={`d-flex flex-column align-items-center small text-decoration-none ${pathname === "/create" ? "text-body" : "text-body-secondary"}`}>
          <i className="bi bi-pencil-square fs-5" />
          <span>Create</span>
        </Link>
        <Link href="/dashboard" className={`d-flex flex-column align-items-center small text-decoration-none ${pathname === "/dashboard" ? "text-body" : "text-body-secondary"}`}>
          <i className="bi bi-person fs-5" />
          <span>Me</span>
        </Link>
      </nav>
    </>
  );
}
