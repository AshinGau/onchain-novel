"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";

export function ReportModal({ novelId, chapterId }: { novelId: string; chapterId: string }) {
  const { isConnected } = useAccount();
  const [open, setOpen] = useState(false);

  if (!isConnected) {
    return (
      <Button variant="outline" size="sm" disabled className="opacity-50">
        Report
      </Button>
    );
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-red-400 border-red-800 hover:bg-red-950"
      >
        Report
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-900 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-neutral-400">Report Content</h4>
        <button onClick={() => setOpen(false)} className="text-neutral-500 hover:text-neutral-300 text-sm">
          Close
        </button>
      </div>
      <p className="text-xs text-neutral-500">Content reporting is under development. On-chain reporting with bond-based arbitration will be available in a future release.</p>

      <Button
        size="sm"
        variant="outline"
        className="w-full border-neutral-700 text-neutral-500 cursor-not-allowed"
        disabled
      >
        Submit (Coming Soon...)
      </Button>
    </div>
  );
}
