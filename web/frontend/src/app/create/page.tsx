"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther, keccak256, toHex, toBytes } from "viem";
import { NOVEL_CORE_ADDRESS, novelCoreAbi } from "@/lib/contracts";

interface GenesisChapter {
  content: string;
}

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
  contentLocation: 0,
  contentBaseUrl: "",
};

export default function CreateNovelPage() {
  const router = useRouter();
  const { isConnected } = useAccount();

  // Metadata
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [coverUri, setCoverUri] = useState("");

  // Config
  const [config, setConfig] = useState(DEFAULT_CONFIG);

  // Genesis chapters
  const [chapters, setChapters] = useState<GenesisChapter[]>([{ content: "" }]);

  // Initial prize pool
  const [initialPrize, setInitialPrize] = useState("");

  // Submit state
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: txHash, writeContractAsync } = useWriteContract();
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  function updateConfig<K extends keyof typeof DEFAULT_CONFIG>(key: K, value: (typeof DEFAULT_CONFIG)[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  const CONTENT_LOCATIONS = [
    { value: 0, label: "Onchain" },
    { value: 1, label: "External" },
    { value: 2, label: "HTTP" },
  ];

  function addChapter() {
    setChapters((prev) => [...prev, { content: "" }]);
  }

  function removeChapter(index: number) {
    if (chapters.length <= 1) return;
    setChapters((prev) => prev.filter((_, i) => i !== index));
  }

  function updateChapter(index: number, content: string) {
    setChapters((prev) => prev.map((ch, i) => (i === index ? { content } : ch)));
  }

  function byteCount(text: string): number {
    return new TextEncoder().encode(text).length;
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
    if (chapters.some((ch) => !ch.content.trim())) {
      setStatus("All genesis chapters must have content.");
      return;
    }

    setSubmitting(true);
    setStatus("");

    try {
      // Construct ContentSubmission tuples for genesis chapters
      setStatus("Preparing submission...");
      const genesisChapters = chapters.map((ch) => {
        const contentBytes = toHex(toBytes(ch.content));
        const contentHash = keccak256(contentBytes);
        const declaredLength = BigInt(new TextEncoder().encode(ch.content).length);
        return { contentHash, declaredLength, content: contentBytes };
      });

      let value = BigInt(0);
      if (initialPrize && parseFloat(initialPrize) > 0) {
        value = parseEther(initialPrize);
      }

      setStatus("Sending transaction...");
      const hash = await writeContractAsync({
        address: NOVEL_CORE_ADDRESS,
        abi: novelCoreAbi,
        functionName: "createNovel",
        args: [
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
            contentLocation: config.contentLocation,
            contentBaseUrl: config.contentBaseUrl,
          },
          {
            title: title.trim(),
            description: description.trim(),
            coverUri: coverUri.trim(),
          },
          genesisChapters,
        ],
        value,
      });

      setStatus("Waiting for confirmation...");

      // Poll for receipt since we have the hash
      const { createPublicClient, http } = await import("viem");
      const { mainnet } = await import("viem/chains");
      // Use wagmi's built-in waiting - redirect after tx is mined
      // For now, we'll use a simple approach
      setStatus("Transaction submitted! Redirecting...");

      // Wait briefly then redirect - the useWaitForTransactionReceipt will track it
      // We'll extract novelId from logs in a real implementation
      // For now redirect to home after success
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

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 pb-24 md:pb-8">
      <Link href="/" className="text-sm text-neutral-400 hover:text-white">← Back to Discover</Link>
      <h1 className="text-2xl font-bold mb-1 mt-4">Create a Novel</h1>
      <p className="text-neutral-400 text-sm mb-8">
        Launch a new collaborative story on-chain.
      </p>

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
                placeholder="Describe your novel..."
                rows={3}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Cover Image URL (optional)</label>
              <input
                type="text"
                value={coverUri}
                onChange={(e) => setCoverUri(e.target.value)}
                placeholder="https://..."
                className={inputClass}
              />
              <p className={hintClass}>Direct URL to a cover image.</p>
            </div>
          </div>
        </section>

        {/* Config */}
        <section className="rounded-lg bg-neutral-900 border border-neutral-800 p-5">
          <h2 className="font-semibold mb-4">Novel Configuration</h2>

          {/* Chapter */}
          <div className="mb-5">
            <h3 className="text-sm font-medium text-neutral-400 mb-3">Chapter</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Min Chapter Length (bytes)</label>
                <input
                  type="number"
                  value={config.minChapterLength}
                  onChange={(e) => updateConfig("minChapterLength", Number(e.target.value))}
                  className={inputClass}
                />
                <p className={hintClass}>Minimum content size for each chapter submission.</p>
              </div>
              <div>
                <label className={labelClass}>Max Chapter Length (bytes)</label>
                <input
                  type="number"
                  value={config.maxChapterLength}
                  onChange={(e) => updateConfig("maxChapterLength", Number(e.target.value))}
                  className={inputClass}
                />
                <p className={hintClass}>Maximum content size for each chapter submission.</p>
              </div>
            </div>
          </div>

          {/* Rounds */}
          <div className="mb-5">
            <h3 className="text-sm font-medium text-neutral-400 mb-3">Rounds</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Round Min Duration (seconds)</label>
                <input
                  type="number"
                  value={config.roundMinDuration}
                  onChange={(e) => updateConfig("roundMinDuration", Number(e.target.value))}
                  className={inputClass}
                />
                <p className={hintClass}>Minimum time for the submission phase. Default: 1 day.</p>
              </div>
              <div>
                <label className={labelClass}>Min Submissions per Round</label>
                <input
                  type="number"
                  value={config.roundMinSubmissions}
                  onChange={(e) => updateConfig("roundMinSubmissions", Number(e.target.value))}
                  className={inputClass}
                />
                <p className={hintClass}>Minimum chapter submissions needed to advance.</p>
              </div>
              <div>
                <label className={labelClass}>World Line Count</label>
                <input
                  type="number"
                  value={config.worldLineCount}
                  onChange={(e) => updateConfig("worldLineCount", Number(e.target.value))}
                  className={inputClass}
                />
                <p className={hintClass}>Number of parallel story branches kept each round.</p>
              </div>
              <div>
                <label className={labelClass}>Rounds per Epoch</label>
                <input
                  type="number"
                  value={config.roundsPerEpoch}
                  onChange={(e) => updateConfig("roundsPerEpoch", Number(e.target.value))}
                  className={inputClass}
                />
                <p className={hintClass}>Number of rounds before epoch voting begins.</p>
              </div>
            </div>
          </div>

          {/* Voting */}
          <div className="mb-5">
            <h3 className="text-sm font-medium text-neutral-400 mb-3">Voting</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Commit Duration (seconds)</label>
                <input
                  type="number"
                  value={config.commitDuration}
                  onChange={(e) => updateConfig("commitDuration", Number(e.target.value))}
                  className={inputClass}
                />
                <p className={hintClass}>Time for voters to commit their hidden votes. Default: 3 days.</p>
              </div>
              <div>
                <label className={labelClass}>Reveal Duration (seconds)</label>
                <input
                  type="number"
                  value={config.revealDuration}
                  onChange={(e) => updateConfig("revealDuration", Number(e.target.value))}
                  className={inputClass}
                />
                <p className={hintClass}>Time for voters to reveal their votes. Default: 2 days.</p>
              </div>
            </div>
          </div>

          {/* Economics */}
          <div className="mb-5">
            <h3 className="text-sm font-medium text-neutral-400 mb-3">Economics</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Stake Amount (ETH)</label>
                <input
                  type="text"
                  value={config.stakeAmount}
                  onChange={(e) => updateConfig("stakeAmount", e.target.value)}
                  className={inputClass}
                />
                <p className={hintClass}>ETH required to submit a chapter or vote.</p>
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
                <p className={hintClass}>{config.voterRewardRate / 100}% of epoch rewards go to accurate voters.</p>
              </div>
            </div>
          </div>

          {/* Pollution */}
          <div className="mb-5">
            <h3 className="text-sm font-medium text-neutral-400 mb-3">Pollution</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Pollution Rounds</label>
                <input
                  type="number"
                  value={config.pollutionRounds}
                  onChange={(e) => updateConfig("pollutionRounds", Number(e.target.value))}
                  className={inputClass}
                />
                <p className={hintClass}>Consecutive low-rank rounds before slashing.</p>
              </div>
              <div>
                <label className={labelClass}>Pollution Threshold (%)</label>
                <input
                  type="number"
                  value={config.pollutionThreshold}
                  onChange={(e) => updateConfig("pollutionThreshold", Number(e.target.value))}
                  className={inputClass}
                />
                <p className={hintClass}>Bottom {config.pollutionThreshold}% of authors are flagged.</p>
              </div>
            </div>
          </div>

          {/* Content Storage */}
          <div>
            <h3 className="text-sm font-medium text-neutral-400 mb-3">Content Storage</h3>
            <div className="space-y-4">
              <div>
                <label className={labelClass}>Content Location</label>
                <div className="flex items-center gap-4 mt-1">
                  {CONTENT_LOCATIONS.map((loc) => (
                    <label key={loc.value} className="flex items-center gap-2 text-sm text-neutral-300 cursor-pointer">
                      <input
                        type="radio"
                        name="contentLocation"
                        value={loc.value}
                        checked={config.contentLocation === loc.value}
                        onChange={() => updateConfig("contentLocation", loc.value)}
                        className="accent-white"
                      />
                      {loc.label}
                    </label>
                  ))}
                </div>
                <p className={hintClass}>Where chapter content is stored. Onchain stores content directly in the transaction.</p>
              </div>
              <div>
                <label className={labelClass}>Content Base URL</label>
                <input
                  type="text"
                  value={config.contentBaseUrl}
                  onChange={(e) => updateConfig("contentBaseUrl", e.target.value)}
                  placeholder={config.contentLocation === 0 ? "(not needed for Onchain)" : "https://..."}
                  className={inputClass}
                />
                <p className={hintClass}>Base URL for resolving chapter content (used by External and HTTP modes).</p>
              </div>
            </div>
          </div>
        </section>

        {/* Genesis Chapters */}
        <section className="rounded-lg bg-neutral-900 border border-neutral-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Genesis Chapters</h2>
            <button
              type="button"
              onClick={addChapter}
              className="rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-700 transition-colors"
            >
              + Add Chapter
            </button>
          </div>
          <p className="text-xs text-neutral-500 mb-4">
            At least 1 genesis chapter is required. Each chapter becomes an initial world line.
          </p>
          <div className="space-y-4">
            {chapters.map((ch, i) => (
              <div key={i} className="rounded-lg border border-neutral-700 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-neutral-300">Chapter {i + 1}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-neutral-500">{byteCount(ch.content)} bytes</span>
                    {chapters.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeChapter(i)}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
                <textarea
                  value={ch.content}
                  onChange={(e) => updateChapter(i, e.target.value)}
                  placeholder="Write your genesis chapter..."
                  rows={8}
                  className={inputClass}
                />
              </div>
            ))}
          </div>
        </section>

        {/* Initial Prize Pool */}
        <section className="rounded-lg bg-neutral-900 border border-neutral-800 p-5">
          <h2 className="font-semibold mb-4">Initial Prize Pool</h2>
          <div>
            <label className={labelClass}>ETH Amount (optional)</label>
            <input
              type="text"
              value={initialPrize}
              onChange={(e) => setInitialPrize(e.target.value)}
              placeholder="0.0"
              className={inputClass}
            />
            <p className={hintClass}>Seed the prize pool with ETH to attract early participants.</p>
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
          {submitting ? "Creating..." : !isConnected ? "Connect Wallet to Create" : "Create Novel"}
        </button>
      </form>
    </div>
  );
}
