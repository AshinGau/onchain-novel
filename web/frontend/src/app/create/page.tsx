"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAccount } from "wagmi";
import { parseEther, keccak256, toHex, toBytes } from "viem";
import { NOVEL_CORE_ADDRESS, novelCoreAbi } from "@/lib/contracts";
import { TOKEN_SYMBOL } from "@/lib/config";
import { type NovelConfigForm, DEFAULT_CONFIG, validateAllFields } from "@/lib/novel-config";
import { ConfigForm } from "@/components/config-form";
import { FieldTooltip } from "@/components/field-tooltip";
import { useTxAction, txStatusLabel } from "@/hooks/use-tx-action";

interface GenesisChapter { content: string; }

export default function CreateNovelPage() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [coverUri, setCoverUri] = useState("");
  const [config, setConfig] = useState<NovelConfigForm>(DEFAULT_CONFIG);
  const [chapters, setChapters] = useState<GenesisChapter[]>([{ content: "" }]);
  const [initialPrize, setInitialPrize] = useState("");
  const [validationError, setValidationError] = useState("");

  const tx = useTxAction({ onSuccess: () => { setTimeout(() => router.push("/"), 2000); } });

  function byteCount(text: string): number { return new TextEncoder().encode(text).length; }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setValidationError("");
    if (!isConnected) { setValidationError("Please connect your wallet first."); return; }
    if (!title.trim()) { setValidationError("Title is required."); return; }
    if (chapters.some((ch) => !ch.content.trim())) { setValidationError("All genesis chapters must have content."); return; }
    if (chapters.length > config.worldLineCount) { setValidationError(`Genesis chapters (${chapters.length}) cannot exceed World Line Count (${config.worldLineCount}).`); return; }
    const configError = validateAllFields(config);
    if (configError) { setValidationError(configError); return; }

    const genesisChapters = chapters.map((ch) => {
      const contentBytes = toHex(toBytes(ch.content));
      return { contentHash: keccak256(contentBytes), declaredLength: BigInt(new TextEncoder().encode(ch.content).length), content: contentBytes };
    });

    let value = BigInt(0);
    if (initialPrize && parseFloat(initialPrize) > 0) value = parseEther(initialPrize);

    tx.writeContract({
      address: NOVEL_CORE_ADDRESS, abi: novelCoreAbi, functionName: "createNovel",
      args: [
        { minChapterLength: BigInt(config.minChapterLength), maxChapterLength: BigInt(config.maxChapterLength), roundMinDuration: BigInt(config.roundMinDuration), roundMinSubmissions: config.roundMinSubmissions, worldLineCount: config.worldLineCount, roundsPerEpoch: config.roundsPerEpoch, prizeReleaseRate: config.prizeReleaseRate, voterRewardRate: config.voterRewardRate, commitDuration: BigInt(config.commitDuration), revealDuration: BigInt(config.revealDuration), stakeAmount: parseEther(config.stakeAmount), pollutionRounds: config.pollutionRounds, pollutionThreshold: config.pollutionThreshold, contentLocation: config.contentLocation, contentBaseUrl: config.contentBaseUrl },
        { title: title.trim(), description: description.trim(), coverUri: coverUri.trim() },
        genesisChapters,
      ],
      value,
    });
  }

  return (
    <div className="container py-4 pb-5" style={{ maxWidth: 720 }}>
      <Link href="/" className="small text-body-secondary text-decoration-none">&larr; Back to Discover</Link>
      <h2 className="fw-bold mb-1 mt-3">Create a Novel</h2>
      <p className="text-body-secondary small mb-4">Launch a new collaborative story on-chain.</p>

      <form onSubmit={handleSubmit} className="d-flex flex-column gap-4">
        {/* Metadata */}
        <div className="card"><div className="card-body">
          <h5 className="card-title">Novel Metadata</h5>
          <div className="d-flex flex-column gap-3">
            <div>
              <label className="form-label small">Title *</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Enter novel title" className="form-control" required />
            </div>
            <div>
              <label className="form-label small">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe your novel..." rows={3} className="form-control" />
            </div>
            <div>
              <label className="form-label small">Cover Image URL (optional)</label>
              <input type="text" value={coverUri} onChange={(e) => setCoverUri(e.target.value)} placeholder="https://..." className="form-control" />
            </div>
          </div>
        </div></div>

        {/* Config */}
        <div className="card"><div className="card-body">
          <h5 className="card-title">Novel Configuration</h5>
          <ConfigForm config={config} onChange={setConfig} />
        </div></div>

        {/* Genesis Chapters */}
        <div className="card"><div className="card-body">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h5 className="card-title mb-0">Genesis Chapters</h5>
            <button type="button" onClick={() => setChapters((prev) => [...prev, { content: "" }])} className="btn btn-outline-secondary btn-sm">+ Add Genesis</button>
          </div>
          <p className="form-text mb-3">At least 1 genesis chapter is required. Each becomes an initial world line (max {config.worldLineCount}).</p>
          <div className="d-flex flex-column gap-3">
            {chapters.map((ch, i) => (
              <div key={i} className="card card-body bg-body-tertiary">
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <span className="small fw-medium">Genesis {i + 1}</span>
                  <div className="d-flex align-items-center gap-2">
                    <span className="small text-body-tertiary">{byteCount(ch.content)} bytes</span>
                    {chapters.length > 1 && <button type="button" onClick={() => setChapters((prev) => prev.filter((_, j) => j !== i))} className="btn btn-link btn-sm text-danger p-0">Remove</button>}
                  </div>
                </div>
                <textarea value={ch.content} onChange={(e) => setChapters((prev) => prev.map((c, j) => j === i ? { content: e.target.value } : c))}
                  placeholder="Write your genesis chapter..." rows={8} className="form-control" />
              </div>
            ))}
          </div>
        </div></div>

        {/* Initial Prize Pool */}
        <div className="card"><div className="card-body">
          <h5 className="card-title">Initial Prize Pool</h5>
          <label className="form-label small">{TOKEN_SYMBOL} Amount (optional) <FieldTooltip content="Seed the prize pool to attract early authors and voters." /></label>
          <input type="text" value={initialPrize} onChange={(e) => setInitialPrize(e.target.value)} placeholder="0.0" className="form-control" />
          <div className="form-text">Seed the prize pool with {TOKEN_SYMBOL} to attract early participants.</div>
        </div></div>

        {/* Status */}
        {validationError && <div className="alert alert-danger small">{validationError}</div>}
        {tx.isError && <div className="alert alert-danger small">{tx.error}</div>}
        {tx.isSuccess && <div className="alert alert-success small">Novel created! Redirecting...</div>}

        <button type="submit" disabled={tx.isBusy || !isConnected} className="btn btn-primary btn-lg w-100">
          {tx.isBusy ? txStatusLabel(tx.status, "Create Novel") : !isConnected ? "Connect Wallet to Create" : "Create Novel"}
        </button>
      </form>
    </div>
  );
}
