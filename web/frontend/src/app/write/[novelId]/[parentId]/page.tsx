"use client";

import { use, useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { keccak256, toHex, toBytes } from "viem";
import { fetchApi, type Novel, type Chapter } from "@/lib/api";
import { NOVEL_CORE_ADDRESS, novelCoreAbi } from "@/lib/contracts";
import { TOKEN_SYMBOL } from "@/lib/config";
import { shortenAddress, formatEth } from "@/lib/format";
import { useTxAction, txStatusLabel } from "@/hooks/use-tx-action";

export default function WritePage({ params }: { params: Promise<{ novelId: string; parentId: string }> }) {
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

  const tx = useTxAction({ onSuccess: () => { localStorage.removeItem(draftKey); router.push(`/novels/${novelId}`); } });

  const byteCount = new TextEncoder().encode(content).length;
  const minLen = novel ? Number(novel.config.minChapterLength) : 0;
  const maxLen = novel ? Number(novel.config.maxChapterLength) : Infinity;
  const bytesInRange = byteCount >= minLen && byteCount <= maxLen;
  const [editorBlurred, setEditorBlurred] = useState(false);
  const tooShort = byteCount > 0 && byteCount < minLen;
  const tooLong = byteCount > maxLen;
  const showLengthError = tooLong || (tooShort && editorBlurred);

  useEffect(() => {
    async function load() {
      setLoadingContext(true);
      try {
        const [novelData, contextData] = await Promise.all([fetchApi<Novel>(`/api/novels/${novelId}`), fetchApi<{ ancestors: Chapter[] }>(`/api/chapters/${parentId}/context`)]);
        setNovel(novelData);
        const ancestors = contextData.ancestors || [];
        setParentChapter(ancestors.length > 0 ? ancestors[ancestors.length - 1] : null);
      } catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed to load context"); }
      finally { setLoadingContext(false); }
    }
    load();
  }, [novelId, parentId]);

  useEffect(() => { const saved = localStorage.getItem(draftKey); if (saved) { setContent(saved); lastSavedContent.current = saved; } }, [draftKey]);

  useEffect(() => {
    const saveDraft = () => { if (content && content !== lastSavedContent.current) { localStorage.setItem(draftKey, content); lastSavedContent.current = content; } };
    autoSaveTimer.current = setInterval(saveDraft, 3000);
    const handleBeforeUnload = () => saveDraft();
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => { if (autoSaveTimer.current) clearInterval(autoSaveTimer.current); window.removeEventListener("beforeunload", handleBeforeUnload); saveDraft(); };
  }, [content, draftKey]);

  const handleSubmit = useCallback(() => {
    if (!novel || !isConnected) return; setError(null);
    try {
      const contentBytes = toHex(toBytes(content));
      tx.writeContract({ address: NOVEL_CORE_ADDRESS, abi: novelCoreAbi, functionName: "submitChapter",
        args: [BigInt(novelId), BigInt(parentId), { contentHash: keccak256(contentBytes), declaredLength: BigInt(new TextEncoder().encode(content).length), content: contentBytes }],
        value: BigInt(novel.config.stakeAmount) > BigInt(0) ? BigInt(novel.config.stakeAmount) : undefined });
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "Submission failed"); }
  }, [novel, isConnected, content, novelId, parentId, tx]);

  if (loadingContext) return <div className="container py-5" style={{ maxWidth: 720 }}><p className="text-body-tertiary">Loading...</p></div>;

  const stakeDisplay = novel ? formatEth(novel.config.stakeAmount) : "0";

  return (
    <div className="container py-4 pb-5" style={{ maxWidth: 720 }}>
      <Link href={`/novels/${novelId}`} className="small text-body-secondary text-decoration-none">&larr; Back to novel</Link>

      <h2 className="fw-bold mb-1 mt-3">Write Chapter</h2>
      <p className="text-body-secondary small mb-4">
        {novel?.title ? `Novel: ${novel.title}` : `Novel #${novelId}`}
        {" "}&middot; Continuing from Candidate(ID.{parentId})
        {novel && <> &middot; Stake: {stakeDisplay} {TOKEN_SYMBOL}</>}
      </p>

      {parentChapter?.content_text && (
        <details className="card mb-3" open>
          <summary className="card-header fw-semibold small" role="button">Parent Candidate(ID.{parentId}) by {shortenAddress(parentChapter.author)}</summary>
          <div className="card-body small text-body-secondary" style={{ maxHeight: 200, overflowY: "auto", whiteSpace: "pre-wrap" }}>{parentChapter.content_text}</div>
        </details>
      )}

      {/* Write / Preview toggle */}
      <div className="btn-group btn-group-sm mb-2">
        <button onClick={() => setPreview(false)} className={`btn ${!preview ? "btn-primary" : "btn-outline-secondary"}`}>Write</button>
        <button onClick={() => setPreview(true)} className={`btn ${preview ? "btn-primary" : "btn-outline-secondary"}`}>Preview</button>
      </div>

      {!preview ? (
        <textarea value={content} onChange={(e) => { setContent(e.target.value); setEditorBlurred(false); }}
          onBlur={() => setEditorBlurred(true)} placeholder="Write your chapter here..."
          className="form-control mb-2" rows={16} />
      ) : (
        <div className="card card-body mb-2 chapter-prose" style={{ minHeight: 400 }}>
          {content || <span className="text-body-tertiary">Nothing to preview</span>}
        </div>
      )}

      <div className="d-flex justify-content-between small mb-2">
        <span className={byteCount === 0 ? "text-body-tertiary" : showLengthError ? "text-danger" : "text-body-secondary"}>
          {byteCount.toLocaleString()} bytes
          {novel && <span className="text-body-tertiary"> / {minLen.toLocaleString()}&ndash;{maxLen.toLocaleString()} allowed</span>}
        </span>
        {content && content === lastSavedContent.current && <span className="text-body-tertiary">Draft saved</span>}
      </div>

      {showLengthError && <div className="text-danger small mb-2">{tooShort ? `Content is too short. Minimum is ${minLen.toLocaleString()} bytes.` : `Content is too long. Maximum is ${maxLen.toLocaleString()} bytes.`}</div>}
      {(error || tx.isError) && <div className="alert alert-danger small">{error || tx.error}</div>}
      {tx.isBusy && <div className="alert alert-warning small py-2">{tx.isPending ? "Waiting for signature..." : "Confirming on-chain..."}</div>}
      {tx.isSuccess && <div className="alert alert-success small">Chapter submitted! Redirecting...</div>}

      <div className="d-flex align-items-center gap-3 mt-3">
        <button onClick={handleSubmit} disabled={!isConnected || !bytesInRange || byteCount === 0 || tx.isBusy || tx.isSuccess}
          className="btn btn-primary btn-lg">
          {tx.isBusy ? txStatusLabel(tx.status, "Submit") : `Submit (${stakeDisplay} ${TOKEN_SYMBOL})`}
        </button>
        {!isConnected && <span className="small text-body-tertiary">Connect wallet to submit</span>}
      </div>
    </div>
  );
}
