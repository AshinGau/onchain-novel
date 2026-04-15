"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const onSuccessRef = useRef<(() => void) | undefined>(undefined);

  const { writeContractAsync } = useWriteContract();

  const { isSuccess, isError, error: receiptError } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (!txHash || status !== "waiting") return;
    if (isSuccess) {
      setStatus("success");
      onSuccessRef.current?.();
    } else if (isError) {
      setStatus("error");
      setError(receiptError?.message?.slice(0, 200) || "Transaction reverted");
    }
  }, [txHash, status, isSuccess, isError, receiptError]);

  const send = useCallback(
    async (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      params: any,
      onSuccess?: () => void,
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
    isPending: status === "confirming" || status === "waiting",
  };
}
