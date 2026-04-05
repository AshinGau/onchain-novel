"use client";

import { useState } from "react";
import { parseEther } from "viem";
import { useWriteContract, useWaitForTransactionReceipt, useAccount } from "wagmi";
import { PRIZE_POOL_ADDRESS, prizePoolAbi } from "@/lib/contracts";
import { TOKEN_SYMBOL, DEFAULT_STAKE } from "@/lib/config";
import { parseTxError } from "@/lib/parse-tx-error";

export function TipButton({ novelId }: { novelId: string }) {
  const { isConnected } = useAccount();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(DEFAULT_STAKE);

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash, query: { enabled: !!hash } });

  function handleTip() {
    writeContract({
      address: PRIZE_POOL_ADDRESS,
      abi: prizePoolAbi,
      functionName: "tipNovel",
      args: [BigInt(novelId)],
      value: parseEther(amount),
    });
  }

  if (!isConnected) {
    return <button className="btn btn-outline-secondary btn-sm" disabled>Connect wallet to tip</button>;
  }

  if (!open) {
    return (
      <button className="btn btn-outline-warning btn-sm" onClick={() => setOpen(true)}>
        Tip this Novel
      </button>
    );
  }

  return (
    <div className="d-flex align-items-center gap-2">
      <div className="input-group input-group-sm" style={{ width: 160 }}>
        <input type="number" step="0.001" min="0.001" value={amount}
          onChange={e => setAmount(e.target.value)}
          className="form-control" disabled={isPending || isConfirming} />
        <span className="input-group-text">{TOKEN_SYMBOL}</span>
      </div>
      <button className="btn btn-primary btn-sm"
        onClick={handleTip}
        disabled={isPending || isConfirming || !amount || parseFloat(amount) < 0.001}>
        {isPending ? "Confirming..." : isConfirming ? "Processing..." : "Send Tip"}
      </button>
      <button className="btn btn-outline-secondary btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      {isSuccess && <span className="text-success small">Tip sent!</span>}
      {error && <span className="text-danger small">{parseTxError(error).message}</span>}
    </div>
  );
}
