"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { toHex, keccak256 } from "viem";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useTxAction } from "@/hooks/use-tx-action";
import { NOVEL_CORE_ADDRESS, novelCoreAbi } from "@/lib/contracts";

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
  const [content, setContent] = useState("");
  const { send, status, error, isPending, reset } = useTxAction();

  const contentBytes = new TextEncoder().encode(content);
  const byteLength = contentBytes.length;
  const tooShort = byteLength < minLength;
  const tooLong = byteLength > maxLength;
  const valid = !tooShort && !tooLong && content.trim().length > 0;

  async function handleSubmit() {
    if (!valid) return;

    const contentHex = toHex(contentBytes);
    const contentHash = keccak256(contentHex);
    const declaredLength = BigInt(byteLength);

    const submission =
      contentLocation === 0
        ? {
            contentHash,
            declaredLength,
            content: contentHex as `0x${string}`,
          }
        : {
            contentHash,
            declaredLength,
            content: "0x" as `0x${string}`,
          };

    await send(
      {
        address: NOVEL_CORE_ADDRESS,
        abi: novelCoreAbi,
        functionName: "submitChapter",
        args: [BigInt(novelId), BigInt(parentId), submission],
        value: BigInt(submissionFee),
      },
      () => {
        setContent("");
        onSuccess?.();
      }
    );
  }

  if (!isConnected) {
    return (
      <div className="v2-card v2-stack" style={{ gap: "0.75rem", alignItems: "center" }}>
        <p className="text-caption">Connect wallet to write a continuation</p>
        <ConnectButton />
      </div>
    );
  }

  return (
    <div className="v2-card v2-stack" style={{ gap: "0.75rem" }}>
      <h3 className="text-subheading" style={{ margin: 0 }}>Write continuation</h3>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Write your chapter here..."
        rows={10}
        style={{
          width: "100%",
          padding: "0.75rem",
          borderRadius: "0.5rem",
          border: "1px solid var(--color-v2-border)",
          background: "var(--color-v2-bg-secondary)",
          color: "var(--color-v2-text)",
          fontFamily: "Georgia, 'Noto Serif', serif",
          fontSize: "1rem",
          lineHeight: 1.75,
          resize: "vertical",
        }}
      />
      <div className="v2-row" style={{ justifyContent: "space-between" }}>
        <span
          className="text-caption"
          style={{
            color: tooShort || tooLong ? "var(--color-v2-danger)" : undefined,
          }}
        >
          {byteLength} bytes (min: {minLength}, max: {maxLength})
        </span>
        <button
          className="v2-btn v2-btn-primary"
          onClick={handleSubmit}
          disabled={!valid || isPending}
          style={{ opacity: !valid || isPending ? 0.5 : 1 }}
        >
          {isPending ? "Submitting..." : "Submit Chapter"}
        </button>
      </div>
      {status === "success" && (
        <p style={{ color: "var(--color-v2-success)", margin: 0, fontSize: "0.875rem" }}>
          Chapter submitted successfully!
        </p>
      )}
      {error && (
        <p style={{ color: "var(--color-v2-danger)", margin: 0, fontSize: "0.875rem" }}>
          {error}
        </p>
      )}
    </div>
  );
}
