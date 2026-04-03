"use client";

import { useState } from "react";
import { parseEther } from "viem";
import { useWriteContract, useWaitForTransactionReceipt, useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { PRIZE_POOL_ADDRESS, prizePoolAbi } from "@/lib/contracts";
import { TOKEN_SYMBOL, DEFAULT_STAKE } from "@/lib/config";

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
    return (
      <Button variant="outline" size="sm" disabled className="opacity-50">
        Connect wallet to tip
      </Button>
    );
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="text-amber-400 border-amber-600 hover:bg-amber-950">
        Tip this Novel
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        step="0.001"
        min="0.001"
        value={amount}
        onChange={e => setAmount(e.target.value)}
        className="w-24 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm"
        disabled={isPending || isConfirming}
      />
      <span className="text-sm text-neutral-400">{TOKEN_SYMBOL}</span>
      <Button
        size="sm"
        onClick={handleTip}
        disabled={isPending || isConfirming || !amount || parseFloat(amount) < 0.001}
      >
        {isPending ? "Confirming..." : isConfirming ? "Processing..." : "Send Tip"}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      {isSuccess && <span className="text-green-400 text-sm">Tip sent!</span>}
      {error && <span className="text-red-400 text-sm">{error.message.slice(0, 60)}</span>}
    </div>
  );
}
