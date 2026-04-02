"use client";

import { useState } from "react";
import { parseEther } from "viem";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { Button } from "@/components/ui/button";
import { uploadText } from "@/lib/arweave";
import { REPORT_REGISTRY_ADDRESS, reportRegistryAbi } from "@/lib/contracts";

const REASONS = ["Plagiarism", "Abuse", "Spam", "Other"] as const;

export function ReportModal({ novelId, chapterId }: { novelId: string; chapterId: string }) {
  const { isConnected } = useAccount();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>(REASONS[0]);
  const [evidence, setEvidence] = useState("");
  const [bondAmount, setBondAmount] = useState("0.01");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { writeContract, data: hash, isPending, error: txError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  async function handleSubmit() {
    if (!evidence.trim() || !bondAmount) return;
    setUploading(true);
    setUploadError(null);
    try {
      const fullEvidence = `Reason: ${reason}\n\n${evidence}`;
      const { contentHash } = await uploadText(fullEvidence, [
        { name: "App-Name", value: "OnchainNovel" },
        { name: "Type", value: "Report" },
        { name: "Novel-Id", value: novelId },
        { name: "Chapter-Id", value: chapterId },
      ]);

      writeContract({
        address: REPORT_REGISTRY_ADDRESS,
        abi: reportRegistryAbi,
        functionName: "reportContent",
        args: [BigInt(novelId), BigInt(chapterId), contentHash],
        value: parseEther(bondAmount),
      });
    } catch (err: any) {
      setUploadError(err.message || "Failed to upload evidence");
    } finally {
      setUploading(false);
    }
  }

  if (!isConnected) {
    return (
      <Button variant="outline" size="sm" disabled className="opacity-50">
        Connect wallet to report
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
    <div className="rounded-lg border border-red-900 bg-neutral-900 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-red-400">Report Content</h4>
        <button onClick={() => setOpen(false)} className="text-neutral-500 hover:text-neutral-300 text-sm">
          Close
        </button>
      </div>

      {/* Reason */}
      <div className="space-y-1">
        <label className="text-xs text-neutral-400">Reason</label>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm"
        >
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {/* Evidence */}
      <div className="space-y-1">
        <label className="text-xs text-neutral-400">Evidence Description</label>
        <textarea
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          placeholder="Describe the issue and provide evidence..."
          rows={4}
          className="w-full rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm resize-none placeholder:text-neutral-500"
        />
      </div>

      {/* Bond */}
      <div className="space-y-1">
        <label className="text-xs text-neutral-400">Bond Amount (ETH)</label>
        <input
          type="number"
          step="0.001"
          min="0.001"
          value={bondAmount}
          onChange={(e) => setBondAmount(e.target.value)}
          className="w-full rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm"
        />
        <p className="text-xs text-neutral-500">
          Bond is returned if the report is upheld, forfeited otherwise.
        </p>
      </div>

      {/* Submit */}
      <Button
        size="sm"
        variant="outline"
        className="w-full border-red-800 text-red-400 hover:bg-red-950"
        onClick={handleSubmit}
        disabled={uploading || isPending || isConfirming || !evidence.trim()}
      >
        {uploading
          ? "Uploading evidence..."
          : isPending
            ? "Confirm in wallet..."
            : isConfirming
              ? "Processing..."
              : "Submit Report"}
      </Button>

      {isSuccess && (
        <p className="text-green-400 text-sm">Report submitted successfully!</p>
      )}
      {uploadError && <p className="text-red-400 text-sm">{uploadError}</p>}
      {txError && <p className="text-red-400 text-sm">{txError.message.slice(0, 80)}</p>}
    </div>
  );
}
