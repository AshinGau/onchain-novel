"use client";

import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAccount } from "wagmi";
import { parseEther } from "viem";
import { NOVEL_CORE_ADDRESS, novelCoreAbi } from "@/lib/contracts";
import { fetchApi, type Novel } from "@/lib/api";
import { formatEth } from "@/lib/format";
import { TOKEN_SYMBOL } from "@/lib/config";
import { type NovelConfigForm, DEFAULT_CONFIG, validateAllFields } from "@/lib/novel-config";
import { ConfigForm } from "@/components/config-form";
import { useTxAction, txStatusLabel } from "@/hooks/use-tx-action";

export default function ForkNovelPage({ params }: { params: Promise<{ novelId: string; chapterId: string }> }) {
  const { novelId, chapterId } = use(params);
  const router = useRouter();
  const { isConnected } = useAccount();
  const [sourceNovel, setSourceNovel] = useState<Novel | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [coverUri, setCoverUri] = useState("");
  const [config, setConfig] = useState<NovelConfigForm>(DEFAULT_CONFIG);
  const [forkFee, setForkFee] = useState("");
  const [validationError, setValidationError] = useState("");
  const tx = useTxAction({ onSuccess: () => { setTimeout(() => router.push("/"), 2000); } });

  useEffect(() => {
    async function load() {
      try {
        const novel = await fetchApi<Novel>(`/api/novels/${novelId}`);
        setSourceNovel(novel);
        const c = novel.config;
        setConfig({ minChapterLength: Number(c.minChapterLength), maxChapterLength: Number(c.maxChapterLength), roundMinDuration: Number(c.roundMinDuration), roundMinSubmissions: c.roundMinSubmissions, worldLineCount: c.worldLineCount, roundsPerEpoch: c.roundsPerEpoch, commitDuration: Number(c.commitDuration), revealDuration: Number(c.revealDuration), stakeAmount: (Number(c.stakeAmount) / 1e18).toString(), prizeReleaseRate: c.prizeReleaseRate, voterRewardRate: c.voterRewardRate, pollutionRounds: c.pollutionRounds, pollutionThreshold: c.pollutionThreshold, contentLocation: c.contentLocation, contentBaseUrl: c.contentBaseUrl });
        setForkFee((Number(c.stakeAmount) / 1e18).toString());
      } catch { setFetchError("Failed to load source novel."); }
      finally { setLoading(false); }
    }
    load();
  }, [novelId]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setValidationError("");
    if (!isConnected) { setValidationError("Please connect your wallet first."); return; }
    if (!title.trim()) { setValidationError("Title is required."); return; }
    if (!forkFee || parseFloat(forkFee) <= 0) { setValidationError("Fork fee is required."); return; }
    const minFee = sourceNovel ? Number(sourceNovel.config.stakeAmount) / 1e18 : 0;
    if (parseFloat(forkFee) < minFee) { setValidationError(`Fork fee must be >= ${minFee} ${TOKEN_SYMBOL}.`); return; }
    const configError = validateAllFields(config);
    if (configError) { setValidationError(configError); return; }

    tx.writeContract({
      address: NOVEL_CORE_ADDRESS, abi: novelCoreAbi, functionName: "forkNovel",
      args: [BigInt(novelId), BigInt(chapterId),
        { minChapterLength: BigInt(config.minChapterLength), maxChapterLength: BigInt(config.maxChapterLength), roundMinDuration: BigInt(config.roundMinDuration), roundMinSubmissions: config.roundMinSubmissions, worldLineCount: config.worldLineCount, roundsPerEpoch: config.roundsPerEpoch, prizeReleaseRate: config.prizeReleaseRate, voterRewardRate: config.voterRewardRate, commitDuration: BigInt(config.commitDuration), revealDuration: BigInt(config.revealDuration), stakeAmount: parseEther(config.stakeAmount), pollutionRounds: config.pollutionRounds, pollutionThreshold: config.pollutionThreshold, contentLocation: config.contentLocation, contentBaseUrl: config.contentBaseUrl },
        { title: title.trim(), description: description.trim(), coverUri: coverUri.trim() }],
      value: parseEther(forkFee),
    });
  }

  if (loading) return <div className="container py-4" style={{ maxWidth: 720 }}><p className="text-body-secondary">Loading source novel...</p></div>;
  if (fetchError) return <div className="container py-4" style={{ maxWidth: 720 }}><p className="text-danger">{fetchError}</p></div>;

  const minFeeDisplay = sourceNovel ? formatEth(sourceNovel.config.stakeAmount) : "0";

  return (
    <div className="container py-4 pb-5" style={{ maxWidth: 720 }}>
      <Link href={`/novels/${novelId}`} className="small text-body-secondary text-decoration-none">&larr; Back to Novel</Link>
      <h2 className="fw-bold mb-1 mt-3">Fork a Novel</h2>
      <p className="text-body-secondary small mb-4">Create a new novel branching from an existing chapter.</p>

      <div className="card mb-4"><div className="card-body">
        <h6 className="card-title">Fork Source</h6>
        <p className="small mb-0">Forking from <strong>Novel #{novelId}{sourceNovel?.title ? ` - ${sourceNovel.title}` : ""}</strong> Candidate(ID.{chapterId})</p>
        {sourceNovel?.description && <p className="form-text mb-0">{sourceNovel.description}</p>}
      </div></div>

      <form onSubmit={handleSubmit} className="d-flex flex-column gap-4">
        <div className="card"><div className="card-body">
          <h5 className="card-title">Novel Metadata</h5>
          <div className="d-flex flex-column gap-3">
            <div><label className="form-label small">Title *</label><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Enter novel title" className="form-control" required /></div>
            <div><label className="form-label small">Description</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe your forked novel..." rows={3} className="form-control" /></div>
            <div><label className="form-label small">Cover Image URL (optional)</label><input type="text" value={coverUri} onChange={(e) => setCoverUri(e.target.value)} placeholder="https://..." className="form-control" /></div>
          </div>
        </div></div>

        <div className="card"><div className="card-body">
          <h5 className="card-title">Novel Configuration</h5>
          <p className="form-text mb-3">Prefilled from the source novel. You can modify these.</p>
          <ConfigForm config={config} onChange={setConfig} contentLocationReadOnly />
        </div></div>

        <div className="card"><div className="card-body">
          <h5 className="card-title">Fork Fee</h5>
          <label className="form-label small">{TOKEN_SYMBOL} Amount</label>
          <input type="text" value={forkFee} onChange={(e) => setForkFee(e.target.value)} placeholder="0.0" className="form-control" />
          <div className="form-text">Must be &gt;= {minFeeDisplay} {TOKEN_SYMBOL} (source novel stake amount).</div>
        </div></div>

        {validationError && <div className="alert alert-danger small">{validationError}</div>}
        {tx.isError && <div className="alert alert-danger small">{tx.error}</div>}
        {tx.isSuccess && <div className="alert alert-success small">Novel forked! Redirecting...</div>}

        <button type="submit" disabled={tx.isBusy || !isConnected} className="btn btn-primary btn-lg w-100">
          {tx.isBusy ? txStatusLabel(tx.status, "Fork Novel") : !isConnected ? "Connect Wallet to Fork" : "Fork Novel"}
        </button>
      </form>
    </div>
  );
}
