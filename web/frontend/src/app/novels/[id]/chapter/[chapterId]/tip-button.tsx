"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { parseEther } from "viem";
import { useTxAction } from "@/hooks/use-tx-action";
import { NOVEL_CORE_ADDRESS, novelCoreAbi } from "@/lib/contracts";
import { TxStatusLabel, txButtonLabel } from "@/components/tx-status";

export function TipButton({ chapterId }: { chapterId: string }) {
  const { isConnected } = useAccount();
  const [showInput, setShowInput] = useState(false);
  const [amount, setAmount] = useState("0.001");
  const { send, isPending, status, error, reset } = useTxAction();

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
        setTimeout(() => { setShowInput(false); setAmount("0.001"); reset(); }, 2000);
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
        Tip Author
      </button>
    );
  }

  return (
    <div className="on-row">
      {status !== "success" && (
        <input
          type="text"
          className="on-form-input on-form-input-narrow"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      )}
      {status !== "success" && (
        <button
          type="button"
          className="on-btn on-btn-primary"
          onClick={handleTip}
          disabled={isPending}
        >
          {txButtonLabel(status, "Send Tip")}
        </button>
      )}
      {!isPending && status !== "success" && (
        <button
          type="button"
          className="on-btn on-btn-ghost"
          onClick={() => setShowInput(false)}
        >
          Cancel
        </button>
      )}
      <TxStatusLabel status={status} error={error} successText="Tip sent!" />
    </div>
  );
}
