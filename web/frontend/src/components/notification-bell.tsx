"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useSignMessage } from "wagmi";
import Link from "next/link";
import { API_BASE, signedFetch } from "@/lib/api";
import { timeAgo } from "@/lib/format";

interface Notification {
  id: number;
  recipient: string | null;
  novel_id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  created_at: string;
}

export function NotificationBell() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchNotifications = useCallback(async () => {
    if (!address) return;
    try {
      const [countRes, listRes] = await Promise.all([
        fetch(`${API_BASE}/api/notifications/${address}/unread-count`),
        fetch(`${API_BASE}/api/notifications/${address}?limit=10`),
      ]);
      if (!countRes.ok || !listRes.ok) return;
      const countData = await countRes.json();
      const listData = await listRes.json();
      setUnreadCount(countData.count || 0);
      setNotifications(listData.notifications || []);
    } catch {}
  }, [address]);

  useEffect(() => {
    if (!isConnected) return;
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [isConnected, fetchNotifications]);

  async function markAllRead() {
    if (!address) return;
    try {
      const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
      await signedFetch(
        `${API_BASE}/api/notifications/${address}/mark-read`, "POST",
        unreadIds.length > 0 ? { ids: unreadIds } : {},
        address, signMessageAsync,
      );
      setUnreadCount(0);
      setNotifications(prev => prev.filter(n => n.read));
    } catch {}
  }

  if (!isConnected) return null;

  const typeIcons: Record<string, string> = {
    phase_change: "bi-arrow-repeat",
    reveal_reminder: "bi-exclamation-triangle",
    canon_established: "bi-trophy",
    chapter_submitted: "bi-pencil",
  };

  return (
    <div className="dropdown">
      <button
        onClick={() => { setOpen(!open); if (!open) fetchNotifications(); }}
        className="btn btn-link text-body p-1 position-relative"
        aria-label="Notifications"
      >
        <i className="bi bi-bell fs-5" />
        {unreadCount > 0 && (
          <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger" style={{ fontSize: "0.6rem" }}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="position-fixed top-0 start-0 w-100 h-100" style={{ zIndex: 1049 }} onClick={() => setOpen(false)} />
          <div className="dropdown-menu show end-0 shadow" style={{ width: 320, maxHeight: 400, overflowY: "auto", zIndex: 1050 }}>
            <div className="d-flex justify-content-between align-items-center px-3 py-2 border-bottom">
              <span className="fw-semibold small">Notifications</span>
              {unreadCount > 0 && (
                <button onClick={markAllRead} className="btn btn-link btn-sm p-0 small">Mark all read</button>
              )}
            </div>

            {notifications.length === 0 ? (
              <div className="px-3 py-4 text-center text-body-tertiary small">No notifications yet.</div>
            ) : (
              notifications.map(n => (
                <div key={n.id} className={`dropdown-item-text border-bottom px-3 py-2 ${!n.read ? "bg-body-secondary" : ""}`}>
                  {n.link ? (
                    <Link href={n.link} onClick={() => setOpen(false)} className="text-decoration-none text-body">
                      <NotifContent n={n} typeIcons={typeIcons} />
                    </Link>
                  ) : (
                    <NotifContent n={n} typeIcons={typeIcons} />
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function NotifContent({ n, typeIcons }: { n: Notification; typeIcons: Record<string, string> }) {
  return (
    <>
      <div className="d-flex align-items-center gap-1">
        <i className={`bi ${typeIcons[n.type] || "bi-pin"}`} />
        <span className={`small fw-medium ${!n.read ? "text-body" : "text-body-secondary"}`}>{n.title}</span>
      </div>
      <p className="small text-body-secondary mb-0">{n.message}</p>
      <p className="small text-body-tertiary mb-0">{timeAgo(n.created_at)}</p>
    </>
  );
}
