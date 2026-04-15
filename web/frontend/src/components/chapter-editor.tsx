"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPublicClient, decodeEventLog, http, keccak256, toHex } from "viem";
import { useAccount } from "wagmi";
import { writeContract } from "wagmi/actions";
import { base, foundry } from "wagmi/chains";

import { NOVEL_CORE_ADDRESS, novelCoreAbi } from "@/lib/contracts";
import { wagmiConfig } from "@/lib/wagmi-config";

interface ChapterEditorProps {
  novelId: string;
  parentId: string;
  submissionFee: string;
  minLength: number;
  maxLength: number;
  /** 0=Onchain, 1=External, 2=HTTP */
  contentLocation: number;
  onSuccess?: () => void;
}

export function ChapterEditor({
  novelId,
  parentId,
  submissionFee,
  minLength,
  maxLength,
  contentLocation,
  onSuccess,
}: ChapterEditorProps) {
  const { isConnected } = useAccount();
  const router = useRouter();
  const [content, setContent] = useState("");
  const [blurred, setBlurred] = useState(false);
  const [status, setStatus] = useState<"idle" | "confirming" | "waiting" | "success" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  const contentBytes = new TextEncoder().encode(content);
  const byteLength = contentBytes.length;
  const tooShort = byteLength < minLength;
  const tooLong = byteLength > maxLength;
  const valid = !tooShort && !tooLong && content.trim().length > 0;
  const showLengthError = blurred && (tooShort || tooLong);

  async function handleSubmit() {
    if (!valid) return;

    const contentHex = toHex(contentBytes);
    const contentHash = keccak256(contentHex);
    const declaredLength = BigInt(byteLength);

    const submission =
      contentLocation === 0
        ? { contentHash, declaredLength, content: contentHex as `0x${string}` }
        : { contentHash, declaredLength, content: "0x" as `0x${string}` };

    setStatus("confirming");
    setError(null);

    try {
      const chain = process.env.NEXT_PUBLIC_CHAIN === "base" ? base : foundry;

      const publicClient = createPublicClient({
        chain,
        transport: http(process.env.NEXT_PUBLIC_RPC_URL || "http://localhost:8545"),
      });

      const hash = await writeContract(wagmiConfig, {
        address: NOVEL_CORE_ADDRESS,
        abi: novelCoreAbi,
        functionName: "submitChapter",
        args: [BigInt(novelId), BigInt(parentId), submission],
        value: BigInt(submissionFee),
      });

      setStatus("waiting");

      // Wait for receipt and extract new chapter ID from event logs
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });

      if (receipt.status !== "success") {
        setStatus("error");
        setError("Transaction reverted");
        return;
      }

      // Parse ChapterSubmitted event to get new chapterId
      let newChapterId: string | null = null;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: novelCoreAbi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "ChapterSubmitted") {
            newChapterId = String((decoded.args as any).chapterId);
            break;
          }
        } catch {
          // Not this event
        }
      }

      setStatus("success");

      if (newChapterId) {
        // Navigate to the new chapter — no need to call onSuccess since we're leaving the page
        router.push(`/novels/${novelId}/chapter/${newChapterId}`);
      } else {
        // Fallback: couldn't parse chapter ID from receipt
        setContent("");
        onSuccess?.();
      }
    } catch (err: unknown) {
      setStatus("error");
      const msg = err instanceof Error ? err.message : "Transaction rejected";
      if (msg.includes("User rejected")) {
        setError("Transaction cancelled");
      } else {
        setError(msg.slice(0, 200));
      }
    }
  }

  const isPending = status === "confirming" || status === "waiting";

  if (!isConnected) {
    return (
      <div className="on-card on-stack" style={{ gap: "0.75rem", alignItems: "center" }}>
        <p className="text-caption">Connect wallet to write the next chapter</p>
        <ConnectButton />
      </div>
    );
  }

  return (
    <div className="on-card on-stack" style={{ gap: "0.75rem" }}>
      <h3 className="text-subheading" style={{ margin: 0 }}>
        Write Next Chapter
      </h3>
      <textarea
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          setBlurred(false);
        }}
        onBlur={() => setBlurred(true)}
        placeholder="Write your chapter here..."
        rows={10}
        style={{
          width: "100%",
          padding: "0.75rem",
          borderRadius: "0.5rem",
          border: `1px solid ${showLengthError ? "var(--color-danger)" : "var(--color-border)"}`,
          background: "var(--color-bg-secondary)",
          color: "var(--color-text)",
          fontFamily: "Georgia, 'Noto Serif', serif",
          fontSize: "1rem",
          lineHeight: 1.75,
          resize: "vertical",
        }}
      />
      <div className="on-row-between">
        <span
          className="text-caption"
          style={{
            color: showLengthError ? "var(--color-danger)" : undefined,
          }}
        >
          {byteLength} bytes (min: {minLength}, max: {maxLength})
        </span>
        <button
          className="on-btn on-btn-primary"
          onClick={handleSubmit}
          disabled={!valid || isPending}
          style={{ opacity: !valid || isPending ? 0.5 : 1 }}
        >
          {status === "confirming"
            ? "Confirm in wallet..."
            : status === "waiting"
              ? "Waiting for block..."
              : "Submit Chapter"}
        </button>
      </div>
      {status === "success" && (
        <p style={{ color: "var(--color-success)", margin: 0, fontSize: "0.875rem" }}>
          Chapter submitted! Redirecting...
        </p>
      )}
      {error && (
        <p style={{ color: "var(--color-danger)", margin: 0, fontSize: "0.875rem" }}>{error}</p>
      )}
    </div>
  );
}
