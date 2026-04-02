"use client";

import { use, useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther } from "viem";
import { uploadFile } from "@/lib/arweave";
import { NOVEL_CORE_ADDRESS, novelCoreAbi } from "@/lib/contracts";
import { fetchApi, type Novel } from "@/lib/api";
import { formatEth } from "@/lib/format";

const DEFAULT_CONFIG = {
  minChapterLength: 500,
  maxChapterLength: 50000,
  roundMinDuration: 86400,
  roundMinSubmissions: 3,
  worldLineCount: 2,
  roundsPerEpoch: 3,
  commitDuration: 259200,
  revealDuration: 172800,
  stakeAmount: "0.01",
  prizeReleaseRate: 3000,
  voterRewardRate: 1000,
  pollutionRounds: 3,
  pollutionThreshold: 20,
  contentBaseUrl: "https://arweave.net/",
};

export default function ForkNovelPage({
  params,
}: {
  params: Promise<{ novelId: string; chapterId: string }>;
}) {
  const { novelId, chapterId } = use(params);
  const router = useRouter();
  const { isConnected } = useAccount();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Source novel
  const [sourceNovel, setSourceNovel] = useState<Novel | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");

  // Metadata
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);

  // Config
  const [config, setConfig] = useState(DEFAULT_CONFIG);

  // Fork fee
  const [forkFee, setForkFee] = useState("");

  // Submit state
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: txHash, writeContractAsync } = useWriteContract();
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  // Fetch source novel
  useEffect(() => {
    async function load() {
      try {
        const novel = await fetchApi<Novel>(`/api/novels/${novelId}`);
        setSourceNovel(novel);

        // Prefill config from source novel
        const c = novel.config;
        setConfig({
          minChapterLength: Number(c.minChapterLength),
          maxChapterLength: Number(c.maxChapterLength),
          roundMinDuration: Number(c.roundMinDuration),
          roundMinSubmissions: c.roundMinSubmissions,
          worldLineCount: c.worldLineCount,
          roundsPerEpoch: c.roundsPerEpoch,
          commitDuration: Number(c.commitDuration),
          revealDuration: Number(c.revealDuration),
          stakeAmount: (Number(c.stakeAmount) / 1e18).toString(),
          prizeReleaseRate: c.prizeReleaseRate,
          voterRewardRate: c.voterRewardRate,
          pollutionRounds: c.pollutionRounds,
          pollutionThreshold: c.pollutionThreshold,
          contentBaseUrl: c.contentBaseUrl,
        });

        // Fork fee must be >= source stake amount
        setForkFee((Number(c.stakeAmount) / 1e18).toString());
      } catch {
        setFetchError("Failed to load source novel.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [novelId]);

  function updateConfig<K extends keyof typeof DEFAULT_CONFIG>(key: K, value: (typeof DEFAULT_CONFIG)[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  function handleCoverSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isConnected) {
      setStatus("Please connect your wallet first.");
      return;
    }
    if (!title.trim()) {
      setStatus("Title is required.");
      return;
    }
    if (!forkFee || parseFloat(forkFee) <= 0) {
      setStatus("Fork fee is required.");
      return;
    }

    setSubmitting(true);
    setStatus("");

    try {
      // Upload cover if provided
      let coverUri = "";
      if (coverFile) {
        setStatus("Uploading cover image...");
        const coverTxId = await uploadFile(coverFile);
        coverUri = `https://arweave.net/${coverTxId}`;
      }

      setStatus("Sending transaction...");

      const hash = await writeContractAsync({
        address: NOVEL_CORE_ADDRESS,
        abi: novelCoreAbi,
        functionName: "forkNovel",
        args: [
          BigInt(novelId),
          BigInt(chapterId),
          {
            minChapterLength: BigInt(config.minChapterLength),
            maxChapterLength: BigInt(config.maxChapterLength),
            roundMinDuration: BigInt(config.roundMinDuration),
            roundMinSubmissions: config.roundMinSubmissions,
            worldLineCount: config.worldLineCount,
            roundsPerEpoch: config.roundsPerEpoch,
            prizeReleaseRate: config.prizeReleaseRate,
            voterRewardRate: config.voterRewardRate,
            commitDuration: BigInt(config.commitDuration),
            revealDuration: BigInt(config.revealDuration),
            stakeAmount: parseEther(config.stakeAmount),
            pollutionRounds: config.pollutionRounds,
            pollutionThreshold: config.pollutionThreshold,
            contentBaseUrl: config.contentBaseUrl,
          },
          {
            title: title.trim(),
            description: description.trim(),
            coverUri,
          },
        ],
        value: parseEther(forkFee),
      });

      setStatus("Waiting for confirmation...");
      setStatus("Transaction submitted! Redirecting...");

      setTimeout(() => {
        router.push("/");
      }, 3000);
    } catch (err: any) {
      setStatus(`Error: ${err?.shortMessage || err?.message || "Unknown error"}`);
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-lg bg-neutral-900 border border-neutral-700 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-500";
  const labelClass = "block text-sm font-medium text-neutral-300 mb-1";
  const hintClass = "text-xs text-neutral-500 mt-1";

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-neutral-400">Loading source novel...</p>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-red-400">{fetchError}</p>
      </div>
    );
  }

  const minFeeDisplay = sourceNovel ? formatEth(sourceNovel.config.stakeAmount) : "0";

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 pb-24 md:pb-8">
      <h1 className="text-2xl font-bold mb-1">Fork a Novel</h1>
      <p className="text-neutral-400 text-sm mb-6">
        Create a new novel branching from an existing chapter.
      </p>

      {/* Fork Source Info */}
      <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-4 mb-8">
        <h2 className="font-semibold mb-2">Fork Source</h2>
        <p className="text-sm text-neutral-300">
          Forking from{" "}
          <span className="text-white font-medium">
            Novel #{novelId}
            {sourceNovel?.title ? ` - ${sourceNovel.title}` : ""}
          </span>
          {" "}Chapter #{chapterId}
        </p>
        {sourceNovel?.description && (
          <p className="text-xs text-neutral-500 mt-1">{sourceNovel.description}</p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Metadata */}
        <section className="rounded-lg bg-neutral-900 border border-neutral-800 p-5">
          <h2 className="font-semibold mb-4">Novel Metadata</h2>
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Title *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter novel title"
                className={inputClass}
                required
              />
            </div>
            <div>
              <label className={labelClass}>Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your forked novel..."
                rows={3}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Cover Image (optional)</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleCoverSelect}
                className="hidden"
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg bg-neutral-800 border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-700 transition-colors"
                >
                  {coverFile ? "Change Image" : "Upload Cover"}
                </button>
                {coverPreview && (
                  <img src={coverPreview} alt="Cover preview" className="h-16 w-12 object-cover rounded" />
                )}
                {coverFile && <span className="text-sm text-neutral-400">{coverFile.name}</span>}
              </div>
            </div>
          </div>
        </section>

        {/* Config */}
        <section className="rounded-lg bg-neutral-900 border border-neutral-800 p-5">
          <h2 className="font-semibold mb-1">Novel Configuration</h2>
          <p className="text-xs text-neutral-500 mb-4">Prefilled from the source novel. You can modify these.</p>

          {/* Chapter */}
          <div className="mb-5">
            <h3 className="text-sm font-medium text-neutral-400 mb-3">Chapter</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Min Chapter Length (bytes)</label>
                <input
                  type="number"
                  value={config.minChapterLength}
                  onChange={(e) => updateConfig("minChapterLength", Number(e.target.value))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Max Chapter Length (bytes)</label>
                <input
                  type="number"
                  value={config.maxChapterLength}
                  onChange={(e) => updateConfig("maxChapterLength", Number(e.target.value))}
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          {/* Rounds */}
          <div className="mb-5">
            <h3 className="text-sm font-medium text-neutral-400 mb-3">Rounds</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Round Min Duration (seconds)</label>
                <input
                  type="number"
                  value={config.roundMinDuration}
                  onChange={(e) => updateConfig("roundMinDuration", Number(e.target.value))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Min Submissions per Round</label>
                <input
                  type="number"
                  value={config.roundMinSubmissions}
                  onChange={(e) => updateConfig("roundMinSubmissions", Number(e.target.value))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>World Line Count</label>
                <input
                  type="number"
                  value={config.worldLineCount}
                  onChange={(e) => updateConfig("worldLineCount", Number(e.target.value))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Rounds per Epoch</label>
                <input
                  type="number"
                  value={config.roundsPerEpoch}
                  onChange={(e) => updateConfig("roundsPerEpoch", Number(e.target.value))}
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          {/* Voting */}
          <div className="mb-5">
            <h3 className="text-sm font-medium text-neutral-400 mb-3">Voting</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Commit Duration (seconds)</label>
                <input
                  type="number"
                  value={config.commitDuration}
                  onChange={(e) => updateConfig("commitDuration", Number(e.target.value))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Reveal Duration (seconds)</label>
                <input
                  type="number"
                  value={config.revealDuration}
                  onChange={(e) => updateConfig("revealDuration", Number(e.target.value))}
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          {/* Economics */}
          <div className="mb-5">
            <h3 className="text-sm font-medium text-neutral-400 mb-3">Economics</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Stake Amount (ETH)</label>
                <input
                  type="text"
                  value={config.stakeAmount}
                  onChange={(e) => updateConfig("stakeAmount", e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Prize Release Rate (bps)</label>
                <input
                  type="number"
                  value={config.prizeReleaseRate}
                  onChange={(e) => updateConfig("prizeReleaseRate", Number(e.target.value))}
                  className={inputClass}
                />
                <p className={hintClass}>{config.prizeReleaseRate / 100}% of pool released each epoch.</p>
              </div>
              <div>
                <label className={labelClass}>Voter Reward Rate (bps)</label>
                <input
                  type="number"
                  value={config.voterRewardRate}
                  onChange={(e) => updateConfig("voterRewardRate", Number(e.target.value))}
                  className={inputClass}
                />
                <p className={hintClass}>{config.voterRewardRate / 100}% of epoch rewards go to voters.</p>
              </div>
            </div>
          </div>

          {/* Pollution */}
          <div className="mb-5">
            <h3 className="text-sm font-medium text-neutral-400 mb-3">Pollution</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Pollution Rounds</label>
                <input
                  type="number"
                  value={config.pollutionRounds}
                  onChange={(e) => updateConfig("pollutionRounds", Number(e.target.value))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Pollution Threshold (%)</label>
                <input
                  type="number"
                  value={config.pollutionThreshold}
                  onChange={(e) => updateConfig("pollutionThreshold", Number(e.target.value))}
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          {/* Content Base URL */}
          <div>
            <h3 className="text-sm font-medium text-neutral-400 mb-3">Content</h3>
            <div>
              <label className={labelClass}>Content Base URL</label>
              <input
                type="text"
                value={config.contentBaseUrl}
                readOnly
                className={`${inputClass} opacity-60 cursor-not-allowed`}
              />
            </div>
          </div>
        </section>

        {/* Fork Fee */}
        <section className="rounded-lg bg-neutral-900 border border-neutral-800 p-5">
          <h2 className="font-semibold mb-4">Fork Fee</h2>
          <div>
            <label className={labelClass}>ETH Amount</label>
            <input
              type="text"
              value={forkFee}
              onChange={(e) => setForkFee(e.target.value)}
              placeholder="0.0"
              className={inputClass}
            />
            <p className={hintClass}>
              Must be &gt;= {minFeeDisplay} ETH (source novel stake amount). Fee goes to the original prize pool, with
              creator royalty to the original creator.
            </p>
          </div>
        </section>

        {/* Status & Submit */}
        {status && (
          <div
            className={`rounded-lg border p-3 text-sm ${
              status.startsWith("Error")
                ? "border-red-800 bg-red-950 text-red-300"
                : "border-neutral-700 bg-neutral-900 text-neutral-300"
            }`}
          >
            {status}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !isConnected}
          className="w-full rounded-lg bg-white text-black font-semibold py-3 text-sm hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Forking..." : !isConnected ? "Connect Wallet to Fork" : "Fork Novel"}
        </button>
      </form>
    </div>
  );
}
