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
        type="button"
        className="on-btn on-btn-secondary"
        onClick={() => setShowInput(true)}
      >
        Tip
      </button>
    );
  }

  return (
    <div className="on-row">
      <input
        type="text"
        className="on-form-input on-form-input-narrow"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <button
        type="button"
        className="on-btn on-btn-primary"
        onClick={handleTip}
        disabled={isPending}
      >
        {isPending ? "…" : "Send Tip"}
      </button>
      <button
        type="button"
        className="on-btn on-btn-ghost"
        onClick={() => setShowInput(false)}
      >
        Cancel
      </button>
      {status === "success" && <span className="text-success">Sent!</span>}
      {error && <span className="text-danger">{error}</span>}
    </div>
  );
}
