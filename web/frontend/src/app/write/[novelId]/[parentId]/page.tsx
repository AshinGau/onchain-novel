"use client";

import { use, useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { keccak256, toHex, toBytes } from "viem";
import { Button } from "@/components/ui/button";
import { fetchApi, type Novel, type Chapter } from "@/lib/api";
import { NOVEL_CORE_ADDRESS, novelCoreAbi } from "@/lib/contracts";
import { TOKEN_SYMBOL } from "@/lib/config";
import { shortenAddress, formatEth } from "@/lib/format";
import { useTxAction, txStatusLabel } from "@/hooks/use-tx-action";

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
  const [error, setError] = useState<string | null>(null);
  const [loadingContext, setLoadingContext] = useState(true);

  const draftKey = `draft:${novelId}:${parentId}`;
  const autoSaveTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSavedContent = useRef("");

  const tx = useTxAction({
    onSuccess: () => {
      localStorage.removeItem(draftKey);
      router.push(`/novels/${novelId}`);
    },
  });

  // Byte count via TextEncoder
  const byteCount = new TextEncoder().encode(content).length;
  const minLen = novel ? Number(novel.config.minChapterLength) : 0;
  const maxLen = novel ? Number(novel.config.maxChapterLength) : Infinity;
  const bytesInRange = byteCount >= minLen && byteCount <= maxLen;
  const [editorBlurred, setEditorBlurred] = useState(false);
  const tooShort = byteCount > 0 && byteCount < minLen;
  const tooLong = byteCount > maxLen;
  // Show "too short" only after blur; show "too long" immediately
  const showLengthError = tooLong || (tooShort && editorBlurred);

  // Fetch novel and parent context on mount
  useEffect(() => {
    async function load() {
      setLoadingContext(true);
      try {
        const [novelData, contextData] = await Promise.all([
          fetchApi<Novel>(`/api/novels/${novelId}`),
          fetchApi<{ ancestors: Chapter[] }>(`/api/chapters/${parentId}/context`),
        ]);
        setNovel(novelData);
        // Context API returns ancestor chain ordered root→leaf; last element is the parent chapter itself
        const ancestors = contextData.ancestors || [];
        setParentChapter(ancestors.length > 0 ? ancestors[ancestors.length - 1] : null);
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

  const handleSubmit = useCallback(() => {
    if (!novel || !isConnected) return;
    setError(null);

    try {
      const contentBytes = toHex(toBytes(content));
      const contentHash = keccak256(contentBytes);
      const declaredLength = BigInt(new TextEncoder().encode(content).length);

      tx.writeContract({
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
    }
  }, [novel, isConnected, content, novelId, parentId, tx]);

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
        {" "}&middot; Continuing from Candidate(ID.{parentId})
        {novel && <> &middot; Stake: {stakeDisplay} {TOKEN_SYMBOL}</>}
      </p>

      {/* Parent context */}
      {parentChapter?.content_text && (
        <details className="rounded-lg bg-neutral-900 border border-neutral-800 p-4 mb-6" open>
          <summary className="font-semibold cursor-pointer text-sm text-neutral-300">
            Parent Candidate(ID.{parentId}) by {shortenAddress(parentChapter.author)}
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
          onChange={(e) => { setContent(e.target.value); setEditorBlurred(false); }}
          onBlur={() => setEditorBlurred(true)}
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
              : showLengthError
                ? "text-red-400"
                : "text-neutral-400"
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
      {showLengthError && (
        <p className="mt-2 text-xs text-red-400">
          {tooShort
            ? `Content is too short. Minimum is ${minLen.toLocaleString()} bytes.`
            : `Content is too long. Maximum is ${maxLen.toLocaleString()} bytes.`}
        </p>
      )}

      {/* Error */}
      {(error || tx.isError) && (
        <div className="mt-4 rounded-lg bg-red-950/50 border border-red-900 p-3 text-sm text-red-300">
          {error || tx.error}
        </div>
      )}

      {/* Progress indicator */}
      {tx.isBusy && (
        <div className="mt-4 rounded-lg bg-neutral-900 border border-neutral-800 p-4">
          <div className="flex items-center gap-2">
            <StepIndicator active={true} done={false} />
            <span className="text-sm text-amber-400">
              {tx.isPending ? "Waiting for signature..." : "Confirming on-chain..."}
            </span>
          </div>
        </div>
      )}

      {tx.isSuccess && (
        <div className="mt-4 rounded-lg bg-green-950/50 border border-green-900 p-3 text-sm text-green-300">
          Chapter submitted! Redirecting...
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
            tx.isBusy ||
            tx.isSuccess
          }
          size="lg"
          className="px-6"
        >
          {tx.isBusy
            ? txStatusLabel(tx.status, "Submit")
            : `Submit (${stakeDisplay} ${TOKEN_SYMBOL})`}
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
