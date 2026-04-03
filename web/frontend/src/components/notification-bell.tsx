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
      const countData = await countRes.json();
      const listData = await listRes.json();
      setUnreadCount(countData.count || 0);
      setNotifications(listData.notifications || []);
    } catch {
      // API not available
    }
  }, [address]);

  // Poll every 30 seconds
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
        `${API_BASE}/api/notifications/${address}/mark-read`,
        "POST",
        unreadIds.length > 0 ? { ids: unreadIds } : {},
        address,
        signMessageAsync,
      );
      setUnreadCount(0);
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch {}
  }

  if (!isConnected) return null;

  const typeIcons: Record<string, string> = {
    phase_change: "🔄",
    reveal_reminder: "⚠️",
    canon_established: "🏆",
    chapter_submitted: "📝",
  };

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen(!open); if (!open) fetchNotifications(); }}
        className="relative p-1.5 rounded-md hover:bg-neutral-800 transition-colors"
        aria-label="Notifications"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          {/* Dropdown */}
          <div className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto rounded-lg bg-neutral-900 border border-neutral-700 shadow-xl z-50">
            <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
              <span className="text-sm font-semibold">Notifications</span>
              {unreadCount > 0 && (
                <button onClick={markAllRead} className="text-xs text-blue-400 hover:underline">
                  Mark all read
                </button>
              )}
            </div>

            {notifications.length === 0 ? (
              <div className="px-3 py-6 text-center text-neutral-500 text-sm">
                No notifications yet.
              </div>
            ) : (
              <div>
                {notifications.map(n => (
                  <div
                    key={n.id}
                    className={`px-3 py-2.5 border-b border-neutral-800 last:border-0 ${!n.read ? "bg-neutral-800/50" : ""}`}
                  >
                    {n.link ? (
                      <Link href={n.link} onClick={() => setOpen(false)} className="block">
                        <NotifContent n={n} typeIcons={typeIcons} />
                      </Link>
                    ) : (
                      <NotifContent n={n} typeIcons={typeIcons} />
                    )}
                  </div>
                ))}
              </div>
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
      <div className="flex items-center gap-1.5">
        <span>{typeIcons[n.type] || "📌"}</span>
        <span className={`text-sm font-medium ${!n.read ? "text-white" : "text-neutral-300"}`}>
          {n.title}
        </span>
      </div>
      <p className="text-xs text-neutral-400 mt-0.5">{n.message}</p>
      <p className="text-xs text-neutral-600 mt-0.5">{timeAgo(n.created_at)}</p>
    </>
  );
}
