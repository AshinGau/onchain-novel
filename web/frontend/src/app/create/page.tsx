"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAccount } from "wagmi";
import { parseEther, keccak256, toHex, toBytes } from "viem";
import { NOVEL_CORE_ADDRESS, novelCoreAbi } from "@/lib/contracts";
import { TOKEN_SYMBOL } from "@/lib/config";
import { type NovelConfigForm, DEFAULT_CONFIG, validateAllFields } from "@/lib/novel-config";
import { ConfigForm, inputBase, labelClass, hintClass } from "@/components/config-form";
import { NovelMetadataFields } from "@/components/novel-metadata-fields";
import { FieldTooltip } from "@/components/field-tooltip";
import { useTxAction, txStatusLabel } from "@/hooks/use-tx-action";

interface GenesisChapter {
  content: string;
}

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

  function byteCount(text: string): number {
    return new TextEncoder().encode(text).length;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError("");
    if (!isConnected) { setValidationError("Please connect your wallet first."); return; }
    if (!title.trim()) { setValidationError("Title is required."); return; }
    if (chapters.some((ch) => !ch.content.trim())) { setValidationError("All genesis chapters must have content."); return; }
    if (chapters.length > config.worldLineCount) {
      setValidationError(`Genesis chapters (${chapters.length}) cannot exceed World Line Count (${config.worldLineCount}).`);
      return;
    }
    const configError = validateAllFields(config);
    if (configError) { setValidationError(configError); return; }

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

    tx.writeContract({
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
        { title: title.trim(), description: description.trim(), coverUri: coverUri.trim() },
        genesisChapters,
      ],
      value,
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 pb-24 md:pb-8">
      <Link href="/" className="text-sm text-neutral-400 hover:text-white">← Back to Discover</Link>
      <h1 className="text-2xl font-bold mb-1 mt-4">Create a Novel</h1>
      <p className="text-neutral-400 text-sm mb-8">Launch a new collaborative story on-chain.</p>

      <form onSubmit={handleSubmit} className="space-y-8">
        <NovelMetadataFields
          title={title} setTitle={setTitle}
          description={description} setDescription={setDescription}
          coverUri={coverUri} setCoverUri={setCoverUri}
        />

        {/* Config */}
        <section className="rounded-lg bg-neutral-900 border border-neutral-800 p-5">
          <h2 className="font-semibold mb-4">Novel Configuration</h2>
          <ConfigForm config={config} onChange={setConfig} />
        </section>

        {/* Genesis Chapters */}
        <section className="rounded-lg bg-neutral-900 border border-neutral-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Genesis Chapters</h2>
            <button type="button" onClick={() => setChapters((prev) => [...prev, { content: "" }])}
              className="rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-700 transition-colors">
              + Add Genesis
            </button>
          </div>
          <p className="text-xs text-neutral-500 mb-4">
            At least 1 genesis chapter is required. Each becomes an initial world line (max {config.worldLineCount}).
          </p>
          <div className="space-y-4">
            {chapters.map((ch, i) => (
              <div key={i} className="rounded-lg border border-neutral-700 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-neutral-300">Genesis {i + 1}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-neutral-500">{byteCount(ch.content)} bytes</span>
                    {chapters.length > 1 && (
                      <button type="button" onClick={() => setChapters((prev) => prev.filter((_, j) => j !== i))}
                        className="text-xs text-red-400 hover:text-red-300">Remove</button>
                    )}
                  </div>
                </div>
                <textarea value={ch.content} onChange={(e) => setChapters((prev) => prev.map((c, j) => j === i ? { content: e.target.value } : c))}
                  placeholder="Write your genesis chapter..." rows={8} className={`${inputBase} border-neutral-700`} />
              </div>
            ))}
          </div>
        </section>

        {/* Initial Prize Pool */}
        <section className="rounded-lg bg-neutral-900 border border-neutral-800 p-5">
          <h2 className="font-semibold mb-4">Initial Prize Pool</h2>
          <div>
            <label className={labelClass}>{TOKEN_SYMBOL} Amount (optional) <FieldTooltip content="Seed the prize pool to attract early authors and voters. Decays exponentially each epoch." /></label>
            <input type="text" value={initialPrize} onChange={(e) => setInitialPrize(e.target.value)}
              placeholder="0.0" className={`${inputBase} border-neutral-700`} />
            <p className={hintClass}>Seed the prize pool with {TOKEN_SYMBOL} to attract early participants.</p>
          </div>
        </section>

        {/* Status */}
        {validationError && (
          <div className="rounded-lg border border-red-800 bg-red-950 p-3 text-sm text-red-300">{validationError}</div>
        )}
        {tx.isError && (
          <div className="rounded-lg border border-red-800 bg-red-950 p-3 text-sm text-red-300">{tx.error}</div>
        )}
        {tx.isSuccess && (
          <div className="rounded-lg border border-green-800 bg-green-950 p-3 text-sm text-green-300">Novel created! Redirecting...</div>
        )}

        <button type="submit" disabled={tx.isBusy || !isConnected}
          className="w-full rounded-lg bg-white text-black font-semibold py-3 text-sm hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          {tx.isBusy ? txStatusLabel(tx.status, "Create Novel") : !isConnected ? "Connect Wallet to Create" : "Create Novel"}
        </button>
      </form>
    </div>
  );
}
