"use client";

import { useState } from "react";
import { parseEther } from "viem";
import { useAccount } from "wagmi";

import { txButtonLabel, TxStatusLabel } from "@/components/tx-status";
import { useTxAction } from "@/hooks/use-tx-action";
import { PRIZE_POOL_ADDRESS, prizePoolAbi } from "@/lib/contracts";
import { parsePositiveDecimal } from "@/lib/format";

export function TipButton({ chapterId }: { chapterId: string }) {
  const { isConnected } = useAccount();
  const [showInput, setShowInput] = useState(false);
  const [amount, setAmount] = useState("0.001");
  const [inputError, setInputError] = useState<string | null>(null);
  const { send, isPending, status, error, reset } = useTxAction();

  if (!isConnected) return null;

  async function handleTip() {
    const n = parsePositiveDecimal(amount);
    if (n === null) {
      setInputError("Amount must be a positive number");
      return;
    }
    setInputError(null);
    const value = parseEther(String(n));
    await send(
      {
        address: PRIZE_POOL_ADDRESS,
        abi: prizePoolAbi,
        functionName: "tipChapter",
        args: [BigInt(chapterId)],
        value,
      },
      () => {
        setTimeout(() => {
          setShowInput(false);
          setAmount("0.001");
          reset();
        }, 2000);
      },
    );
  }

  if (!showInput) {
    return (
      <button type="button" className="on-btn on-btn-secondary" onClick={() => setShowInput(true)}>
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
        <button type="button" className="on-btn on-btn-ghost" onClick={() => setShowInput(false)}>
          Cancel
        </button>
      )}
      {inputError && <span className="text-tiny on-error">{inputError}</span>}
      <TxStatusLabel status={status} error={error} successText="Tip sent!" />
    </div>
  );
}
