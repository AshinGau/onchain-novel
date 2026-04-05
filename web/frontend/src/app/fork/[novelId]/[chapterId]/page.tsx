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
import { ConfigForm, inputBase, labelClass, hintClass } from "@/components/config-form";
import { NovelMetadataFields } from "@/components/novel-metadata-fields";
import { useTxAction, txStatusLabel } from "@/hooks/use-tx-action";

export default function ForkNovelPage({
  params,
}: {
  params: Promise<{ novelId: string; chapterId: string }>;
}) {
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
          contentLocation: c.contentLocation,
          contentBaseUrl: c.contentBaseUrl,
        });
        setForkFee((Number(c.stakeAmount) / 1e18).toString());
      } catch {
        setFetchError("Failed to load source novel.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [novelId]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError("");
    if (!isConnected) { setValidationError("Please connect your wallet first."); return; }
    if (!title.trim()) { setValidationError("Title is required."); return; }
    if (!forkFee || parseFloat(forkFee) <= 0) { setValidationError("Fork fee is required."); return; }
    const minFee = sourceNovel ? Number(sourceNovel.config.stakeAmount) / 1e18 : 0;
    if (parseFloat(forkFee) < minFee) {
      setValidationError(`Fork fee must be >= ${minFee} ${TOKEN_SYMBOL} (source novel stake amount).`);
      return;
    }
    const configError = validateAllFields(config);
    if (configError) { setValidationError(configError); return; }

    tx.writeContract({
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
          contentLocation: config.contentLocation,
          contentBaseUrl: config.contentBaseUrl,
        },
        { title: title.trim(), description: description.trim(), coverUri: coverUri.trim() },
      ],
      value: parseEther(forkFee),
    });
  }

  if (loading) {
    return <div className="mx-auto max-w-3xl px-4 py-8"><p className="text-neutral-400">Loading source novel...</p></div>;
  }
  if (fetchError) {
    return <div className="mx-auto max-w-3xl px-4 py-8"><p className="text-red-400">{fetchError}</p></div>;
  }

  const minFeeDisplay = sourceNovel ? formatEth(sourceNovel.config.stakeAmount) : "0";

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 pb-24 md:pb-8">
      <Link href={`/novels/${novelId}`} className="text-sm text-neutral-400 hover:text-white">← Back to Novel</Link>
      <h1 className="text-2xl font-bold mb-1 mt-4">Fork a Novel</h1>
      <p className="text-neutral-400 text-sm mb-6">Create a new novel branching from an existing chapter.</p>

      <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-4 mb-8">
        <h2 className="font-semibold mb-2">Fork Source</h2>
        <p className="text-sm text-neutral-300">
          Forking from{" "}
          <span className="text-white font-medium">Novel #{novelId}{sourceNovel?.title ? ` - ${sourceNovel.title}` : ""}</span>
          {" "}Candidate(ID.{chapterId})
        </p>
        {sourceNovel?.description && <p className="text-xs text-neutral-500 mt-1">{sourceNovel.description}</p>}
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <NovelMetadataFields
          title={title} setTitle={setTitle}
          description={description} setDescription={setDescription}
          coverUri={coverUri} setCoverUri={setCoverUri}
          descriptionPlaceholder="Describe your forked novel..."
        />

        <section className="rounded-lg bg-neutral-900 border border-neutral-800 p-5">
          <h2 className="font-semibold mb-1">Novel Configuration</h2>
          <p className="text-xs text-neutral-500 mb-4">Prefilled from the source novel. You can modify these.</p>
          <ConfigForm config={config} onChange={setConfig} contentLocationReadOnly />
        </section>

        <section className="rounded-lg bg-neutral-900 border border-neutral-800 p-5">
          <h2 className="font-semibold mb-4">Fork Fee</h2>
          <div>
            <label className={labelClass}>{TOKEN_SYMBOL} Amount</label>
            <input type="text" value={forkFee} onChange={(e) => setForkFee(e.target.value)}
              placeholder="0.0" className={`${inputBase} border-neutral-700`} />
            <p className={hintClass}>
              Must be &gt;= {minFeeDisplay} {TOKEN_SYMBOL} (source novel stake amount). Fee goes to the original prize pool.
            </p>
          </div>
        </section>

        {validationError && (
          <div className="rounded-lg border border-red-800 bg-red-950 p-3 text-sm text-red-300">{validationError}</div>
        )}
        {tx.isError && (
          <div className="rounded-lg border border-red-800 bg-red-950 p-3 text-sm text-red-300">{tx.error}</div>
        )}
        {tx.isSuccess && (
          <div className="rounded-lg border border-green-800 bg-green-950 p-3 text-sm text-green-300">Novel forked! Redirecting...</div>
        )}

        <button type="submit" disabled={tx.isBusy || !isConnected}
          className="w-full rounded-lg bg-white text-black font-semibold py-3 text-sm hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          {tx.isBusy ? txStatusLabel(tx.status, "Fork Novel") : !isConnected ? "Connect Wallet to Fork" : "Fork Novel"}
        </button>
      </form>
    </div>
  );
}
