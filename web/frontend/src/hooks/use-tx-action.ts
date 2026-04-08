"use client";

import { useState, useCallback } from "react";
import {
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";

type TxStatus = "idle" | "confirming" | "waiting" | "success" | "error";

/**
 * Wraps wagmi writeContract + waitForTransactionReceipt.
 * Returns a simple `send` function + status/error.
 */
export function useTxAction() {
  const [status, setStatus] = useState<TxStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();

  const { writeContractAsync } = useWriteContract();

  const { isLoading: isWaiting, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const send = useCallback(
    async (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      params: any,
      onSuccess?: () => void
    ) => {
      setStatus("confirming");
      setError(null);
      setTxHash(undefined);
      try {
        const hash = await writeContractAsync(params);
        setTxHash(hash);
        setStatus("waiting");

        // Poll for receipt via a simple loop (wagmi hook will also update)
        // We rely on the hook above for UI but also want to call onSuccess
        const waitForReceipt = async () => {
          const maxAttempts = 60;
          for (let i = 0; i < maxAttempts; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            try {
              const { createPublicClient, http } = await import("viem");
              const { foundry, base } = await import("wagmi/chains");
              const chain =
                process.env.NEXT_PUBLIC_CHAIN === "base" ? base : foundry;
              const client = createPublicClient({
                chain,
                transport: http(
                  process.env.NEXT_PUBLIC_RPC_URL || "http://localhost:8545"
                ),
              });
              const receipt = await client.getTransactionReceipt({ hash });
              if (receipt) {
                if (receipt.status === "success") {
                  setStatus("success");
                  onSuccess?.();
                } else {
                  setStatus("error");
                  setError("Transaction reverted");
                }
                return;
              }
            } catch {
              // Not mined yet
            }
          }
          setStatus("error");
          setError("Transaction confirmation timeout");
        };
        waitForReceipt();
      } catch (err: unknown) {
        setStatus("error");
        const msg =
          err instanceof Error ? err.message : "Transaction rejected";
        // Extract user-readable part
        if (msg.includes("User rejected")) {
          setError("Transaction cancelled");
        } else {
          setError(msg.slice(0, 200));
        }
      }
    },
    [writeContractAsync]
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setTxHash(undefined);
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
