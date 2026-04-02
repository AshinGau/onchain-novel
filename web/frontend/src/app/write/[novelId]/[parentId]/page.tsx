"use client";

import { use, useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { keccak256, toHex, toBytes } from "viem";
import { Button } from "@/components/ui/button";
import { fetchApi, type Novel, type Chapter } from "@/lib/api";
import { NOVEL_CORE_ADDRESS, novelCoreAbi } from "@/lib/contracts";
import { shortenAddress, formatEth } from "@/lib/format";

type SubmitStep = "idle" | "submitting" | "done";

export default function WritePage({
  params,
}: {
  params: Promise<{ novelId: string; parentId: string }>;
}) {
  const { novelId, parentId } = use(params);
  const router = useRouter();
  const { isConnected } = useAccount();

  const [novel, setNovel] = useState<Novel | null>(null);
  const [parentChapter, setParentChapter] = useState<Chapter | null>(null);
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState(false);
  const [submitStep, setSubmitStep] = useState<SubmitStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [loadingContext, setLoadingContext] = useState(true);

  const draftKey = `draft:${novelId}:${parentId}`;
  const autoSaveTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSavedContent = useRef("");

  const { writeContract, data: txHash, error: txError, reset: resetTx } = useWriteContract();
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  // Byte count via TextEncoder
  const byteCount = new TextEncoder().encode(content).length;
  const minLen = novel ? Number(novel.config.minChapterLength) : 0;
  const maxLen = novel ? Number(novel.config.maxChapterLength) : Infinity;
  const bytesInRange = byteCount >= minLen && byteCount <= maxLen;

  // Fetch novel and parent context on mount
  useEffect(() => {
    async function load() {
      setLoadingContext(true);
      try {
        const [novelData, contextData] = await Promise.all([
          fetchApi<Novel>(`/api/novels/${novelId}`),
          fetchApi<{ chapter: Chapter }>(`/api/chapters/${parentId}/context`),
        ]);
        setNovel(novelData);
        setParentChapter(contextData.chapter);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load context");
      } finally {
        setLoadingContext(false);
      }
    }
    load();
  }, [novelId, parentId]);

  // Load draft from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(draftKey);
    if (saved) {
      setContent(saved);
      lastSavedContent.current = saved;
    }
  }, [draftKey]);

  // Auto-save draft every 3 seconds + save on page unload
  useEffect(() => {
    const saveDraft = () => {
      if (content && content !== lastSavedContent.current) {
        localStorage.setItem(draftKey, content);
        lastSavedContent.current = content;
      }
    };

    autoSaveTimer.current = setInterval(saveDraft, 3000);

    const handleBeforeUnload = () => saveDraft();
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      if (autoSaveTimer.current) clearInterval(autoSaveTimer.current);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      saveDraft(); // Save on unmount too
    };
  }, [content, draftKey]);

  // Handle tx confirmation
  useEffect(() => {
    if (txConfirmed && submitStep === "submitting") {
      setSubmitStep("done");
      localStorage.removeItem(draftKey);
      router.push(`/novels/${novelId}`);
    }
  }, [txConfirmed, submitStep, draftKey, novelId, router]);

  // Handle tx error
  useEffect(() => {
    if (txError) {
      setError(txError.message.slice(0, 200));
      setSubmitStep("idle");
    }
  }, [txError]);

  const handleSubmit = useCallback(async () => {
    if (!novel || !isConnected) return;
    setError(null);
    resetTx();

    try {
      setSubmitStep("submitting");
      const contentBytes = toHex(toBytes(content));
      const contentHash = keccak256(contentBytes);
      const declaredLength = BigInt(new TextEncoder().encode(content).length);

      writeContract({
        address: NOVEL_CORE_ADDRESS,
        abi: novelCoreAbi,
        functionName: "submitChapter",
        args: [BigInt(novelId), BigInt(parentId), { contentHash, declaredLength, content: contentBytes }],
        value: BigInt(novel.config.stakeAmount) > BigInt(0)
          ? BigInt(novel.config.stakeAmount)
          : undefined,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Submission failed");
      setSubmitStep("idle");
    }
  }, [novel, isConnected, content, novelId, parentId, writeContract, resetTx]);

  // --- Rendering ---

  if (loadingContext) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <p className="text-neutral-500">Loading...</p>
      </div>
    );
  }

  const stakeDisplay = novel ? formatEth(novel.config.stakeAmount) : "0";

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 pb-24 md:pb-8">
      {/* Back link */}
      <Link
        href={`/novels/${novelId}`}
        className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-200 mb-6"
      >
        &larr; Back to novel
      </Link>

      {/* Header */}
      <h1 className="text-2xl font-bold mb-1">Write Chapter</h1>
      <p className="text-neutral-400 text-sm mb-6">
        {novel?.title ? `Novel: ${novel.title}` : `Novel #${novelId}`}
        {" "}&middot; Continuing from Chapter #{parentId}
        {novel && <> &middot; Stake: {stakeDisplay} ETH</>}
      </p>

      {/* Parent context */}
      {parentChapter?.content_text && (
        <details className="rounded-lg bg-neutral-900 border border-neutral-800 p-4 mb-6" open>
          <summary className="font-semibold cursor-pointer text-sm text-neutral-300">
            Parent Chapter #{parentId} by {shortenAddress(parentChapter.author)}
          </summary>
          <div className="mt-3 text-sm text-neutral-400 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
            {parentChapter.content_text}
          </div>
        </details>
      )}

      {/* Editor / Preview toggle */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => setPreview(false)}
          className={`text-sm px-3 py-1 rounded-md transition-colors ${
            !preview ? "bg-neutral-800 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"
          }`}
        >
          Write
        </button>
        <button
          onClick={() => setPreview(true)}
          className={`text-sm px-3 py-1 rounded-md transition-colors ${
            preview ? "bg-neutral-800 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"
          }`}
        >
          Preview
        </button>
      </div>

      {/* Editor area */}
      {!preview ? (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write your chapter here..."
          className="w-full min-h-[400px] rounded-lg bg-neutral-900 border border-neutral-800 p-4 text-sm text-neutral-100 leading-relaxed placeholder:text-neutral-600 focus:outline-none focus:border-neutral-600 resize-y"
        />
      ) : (
        <div className="w-full min-h-[400px] rounded-lg bg-neutral-900 border border-neutral-800 p-4 text-sm text-neutral-300 whitespace-pre-wrap leading-relaxed">
          {content || <span className="text-neutral-600">Nothing to preview</span>}
        </div>
      )}

      {/* Byte count */}
      <div className="flex items-center justify-between mt-2 text-xs">
        <span
          className={
            byteCount === 0
              ? "text-neutral-500"
              : bytesInRange
                ? "text-neutral-400"
                : "text-red-400"
          }
        >
          {byteCount.toLocaleString()} bytes
          {novel && (
            <span className="text-neutral-600">
              {" "}/ {minLen.toLocaleString()}&ndash;{maxLen.toLocaleString()} allowed
            </span>
          )}
        </span>
        {content && content === lastSavedContent.current && (
          <span className="text-neutral-600">Draft saved</span>
        )}
      </div>

      {/* Byte range warning */}
      {byteCount > 0 && !bytesInRange && (
        <p className="mt-2 text-xs text-red-400">
          {byteCount < minLen
            ? `Content is too short. Minimum is ${minLen.toLocaleString()} bytes.`
            : `Content is too long. Maximum is ${maxLen.toLocaleString()} bytes.`}
        </p>
      )}

      {/* Error */}
      {error && (
        <div className="mt-4 rounded-lg bg-red-950/50 border border-red-900 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Progress indicator */}
      {submitStep === "submitting" && (
        <div className="mt-4 rounded-lg bg-neutral-900 border border-neutral-800 p-4">
          <div className="flex items-center gap-2">
            <StepIndicator active={true} done={false} />
            <span className="text-sm text-amber-400">Submitting on-chain...</span>
          </div>
        </div>
      )}

      {/* Submit button */}
      <div className="mt-6 flex items-center gap-3">
        <Button
          onClick={handleSubmit}
          disabled={
            !isConnected ||
            !bytesInRange ||
            byteCount === 0 ||
            submitStep !== "idle"
          }
          size="lg"
          className="px-6"
        >
          {submitStep === "submitting"
            ? "Submitting..."
            : `Submit (${stakeDisplay} ETH)`}
        </Button>
        {!isConnected && (
          <span className="text-xs text-neutral-500">Connect wallet to submit</span>
        )}
      </div>
    </div>
  );
}

function StepIndicator({ active, done }: { active: boolean; done: boolean }) {
  if (done) {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-900 text-green-300 text-xs">
        &#10003;
      </span>
    );
  }
  if (active) {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-amber-500 animate-pulse">
        <span className="h-2 w-2 rounded-full bg-amber-500" />
      </span>
    );
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-neutral-700">
      <span className="h-2 w-2 rounded-full bg-neutral-700" />
    </span>
  );
}
