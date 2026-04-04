"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseTxError } from "@/lib/parse-tx-error";

export type TxStatus = "idle" | "signing" | "confirming" | "success" | "error";

/**
 * Wraps writeContract + useWaitForTransactionReceipt into a clean lifecycle.
 * Pre-simulates the contract call to surface proper revert errors,
 * then sends the real transaction only if simulation passes.
 * Guarantees: onSuccess only fires after tx is confirmed on-chain.
 */
export function useTxAction(opts?: { onSuccess?: () => void }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContract, data: hash, isPending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: receiptError } = useWaitForTransactionReceipt({
    hash,
    query: { enabled: !!hash },
  });

  const [status, setStatus] = useState<TxStatus>("idle");
  const [simError, setSimError] = useState<Error | null>(null);
  const error = simError || writeError || receiptError;

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
    setSimError(null);
    setStatus("idle");
  }, [reset]);

  /**
   * Simulate first, then send. If simulation reverts, we get a clean
   * ContractFunctionRevertedError with the decoded error name — no more
   * misleading nonce errors.
   */
  const simulateAndWrite = useCallback((params: any) => {
    setSimError(null);
    setStatus("signing");

    if (!publicClient || !address) {
      // Fallback: skip simulation
      writeContract(params);
      return;
    }

    publicClient.simulateContract({
      ...params,
      account: address,
    }).then(() => {
      writeContract(params);
    }).catch((err: any) => {
      setSimError(err);
      setStatus("error");
    });
  }, [writeContract, publicClient, address]);

  const errorMessage = error ? parseTxError(error).message : null;

  return {
    writeContract: simulateAndWrite,
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
