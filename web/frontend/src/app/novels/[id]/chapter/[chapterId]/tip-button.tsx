"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { parseEther } from "viem";
import { useTxAction } from "@/hooks/use-tx-action";
import { NOVEL_CORE_ADDRESS, novelCoreAbi } from "@/lib/contracts";

export function TipButton({ chapterId }: { chapterId: string }) {
  const { isConnected } = useAccount();
  const [showInput, setShowInput] = useState(false);
  const [amount, setAmount] = useState("0.001");
  const { send, isPending, status, error } = useTxAction();

  if (!isConnected) return null;

  async function handleTip() {
    const value = parseEther(amount);
    await send(
      {
        address: NOVEL_CORE_ADDRESS,
        abi: novelCoreAbi,
        functionName: "tipChapter",
        args: [BigInt(chapterId)],
        value,
      },
      () => {
        setShowInput(false);
        setAmount("0.001");
      }
    );
  }

  if (!showInput) {
    return (
      <button
        className="on-btn on-btn-secondary"
        onClick={() => setShowInput(true)}
      >
        Tip
      </button>
    );
  }

  return (
    <div className="on-row" style={{ gap: "0.375rem" }}>
      <input
        type="text"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        style={{
          width: "80px",
          padding: "0.375rem 0.5rem",
          borderRadius: "0.375rem",
          border: "1px solid var(--color-border)",
          background: "var(--color-bg-secondary)",
          color: "var(--color-text)",
          fontSize: "0.875rem",
        }}
      />
      <button
        className="on-btn on-btn-primary"
        onClick={handleTip}
        disabled={isPending}
        style={{ opacity: isPending ? 0.5 : 1 }}
      >
        {isPending ? "..." : "Send Tip"}
      </button>
      <button
        className="on-btn on-btn-ghost"
        onClick={() => setShowInput(false)}
      >
        Cancel
      </button>
      {status === "success" && (
        <span style={{ color: "var(--color-success)", fontSize: "0.875rem" }}>Sent!</span>
      )}
      {error && (
        <span style={{ color: "var(--color-danger)", fontSize: "0.75rem" }}>{error}</span>
      )}
    </div>
  );
}
