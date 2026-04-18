"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TransactionReceipt } from "viem";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";

type TxStatus = "idle" | "confirming" | "waiting" | "success" | "error";

/**
 * Wraps wagmi writeContract + useWaitForTransactionReceipt.
 * Flow: confirming (wallet prompt) → waiting (mempool) → success | error.
 */
export function useTxAction() {
  const [status, setStatus] = useState<TxStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const onSuccessRef = useRef<((receipt: TransactionReceipt) => void) | undefined>(undefined);

  const { writeContractAsync } = useWriteContract();

  const {
    data: receipt,
    isSuccess,
    isError,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash: txHash, pollingInterval: 500 });

  useEffect(() => {
    if (!txHash || status !== "waiting") return;
    if (isSuccess && receipt) {
      setStatus("success");
      onSuccessRef.current?.(receipt);
    } else if (isError) {
      setStatus("error");
      setError(receiptError?.message?.slice(0, 200) || "Transaction reverted");
    }
  }, [txHash, status, isSuccess, isError, receipt, receiptError]);

  const send = useCallback(
    async (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      params: any,
      onSuccess?: (receipt: TransactionReceipt) => void,
    ) => {
      setStatus("confirming");
      setError(null);
      setTxHash(undefined);
      onSuccessRef.current = onSuccess;
      try {
        const hash = await writeContractAsync(params);
        setTxHash(hash);
        setStatus("waiting");
      } catch (err: unknown) {
        setStatus("error");
        const msg = err instanceof Error ? err.message : "Transaction rejected";
        setError(msg.includes("User rejected") ? "Transaction cancelled" : msg.slice(0, 200));
      }
    },
    [writeContractAsync],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setTxHash(undefined);
    onSuccessRef.current = undefined;
  }, []);

  return {
    send,
    reset,
    status,
    error,
    txHash,
    receipt,
    isPending: status === "confirming" || status === "waiting",
  };
}
