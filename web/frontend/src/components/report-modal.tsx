"use client";

import { useState } from "react";
import { useAccount } from "wagmi";

export function ReportModal({ novelId, chapterId }: { novelId: string; chapterId: string }) {
  const { isConnected } = useAccount();
  const [open, setOpen] = useState(false);

  if (!isConnected) {
    return <button className="btn btn-outline-danger btn-sm" disabled>Report</button>;
  }

  if (!open) {
    return <button className="btn btn-outline-danger btn-sm" onClick={() => setOpen(true)}>Report</button>;
  }

  return (
    <div className="card">
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h6 className="card-title mb-0 text-body-secondary">Report Content</h6>
          <button onClick={() => setOpen(false)} className="btn-close btn-sm" />
        </div>
        <p className="small text-body-tertiary">Content reporting is under development. On-chain reporting with bond-based arbitration will be available in a future release.</p>
        <button className="btn btn-outline-secondary btn-sm w-100" disabled>Submit (Coming Soon...)</button>
      </div>
    </div>
  );
}
