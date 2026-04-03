"use client";

import { useCallback, useEffect, useState } from "react";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";

export type TxStatus = "idle" | "signing" | "confirming" | "success" | "error";

/**
 * Wraps writeContract + useWaitForTransactionReceipt into a clean lifecycle.
 * Guarantees: onSuccess only fires after tx is confirmed on-chain.
 */
export function useTxAction(opts?: { onSuccess?: () => void }) {
  const { writeContract, writeContractAsync, data: hash, isPending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: receiptError } = useWaitForTransactionReceipt({
    hash,
    query: { enabled: !!hash },
  });

  const [status, setStatus] = useState<TxStatus>("idle");
  const error = writeError || receiptError;

  useEffect(() => {
    if (isPending) setStatus("signing");
    else if (isConfirming) setStatus("confirming");
    else if (isSuccess) setStatus("success");
    else if (error) setStatus("error");
  }, [isPending, isConfirming, isSuccess, error]);

  useEffect(() => {
    if (isSuccess) opts?.onSuccess?.();
  }, [isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetTx = useCallback(() => {
    reset();
    setStatus("idle");
  }, [reset]);

  const errorMessage = error
    ? (error as any).shortMessage || error.message?.slice(0, 120) || "Transaction failed"
    : null;

  return {
    writeContract,
    writeContractAsync,
    status,
    isPending: status === "signing",
    isConfirming: status === "confirming",
    isSuccess: status === "success",
    isError: status === "error",
    isBusy: status === "signing" || status === "confirming",
    error: errorMessage,
    reset: resetTx,
    hash,
  };
}

/** Human-readable label for current tx status */
export function txStatusLabel(status: TxStatus, defaultLabel: string): string {
  switch (status) {
    case "signing": return "Signing...";
    case "confirming": return "Confirming...";
    case "success": return "Done!";
    case "error": return "Failed";
    default: return defaultLabel;
  }
}
