import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TipButton } from "@/components/tip-modal";
import { VotePanel } from "@/components/vote-panel";
import { RewardsPanel } from "@/components/rewards-panel";
import { fetchApi, type Novel, type TreeChapter } from "@/lib/api";
import { TOKEN_SYMBOL } from "@/lib/config";
import { shortenAddress, formatEth, formatDuration, getPhaseLabel } from "@/lib/format";
import { FieldTooltip } from "@/components/field-tooltip";
import { computeVotingRoundId } from "@/lib/contracts";
import { ConnectedStoryTree } from "@/components/connected-story-tree";
import { PhaseCountdown } from "@/components/phase-countdown";
import { PhaseTransition } from "@/components/phase-transition";

export default async function NovelDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let novel: Novel;
  let tree: TreeChapter[] = [];
  let treeAnchors: TreeChapter[] = [];
  let forks: Novel[] = [];
  let worldlines: { id: string }[] = [];
  let roundCandidates: { id: string; author: string; chapter_index: number; vote_count: string; is_world_line: boolean; content_text?: string | null; comment_count?: string | number }[] = [];
  const warnings: string[] = [];

  try {
    novel = await fetchApi<Novel>(`/api/novels/${id}`);
  } catch {
    notFound();
  }

  try {
    const epoch = novel.current_epoch <= 0 ? 1 : novel.current_epoch;
    const treeData = await fetchApi<{ chapters: TreeChapter[]; anchors: TreeChapter[] }>(`/api/novels/${id}/tree?epoch=${epoch}`);
    tree = treeData.chapters;
    treeAnchors = treeData.anchors || [];
  } catch {
    warnings.push("Failed to load story tree.");
  }

  try {
    const forkData = await fetchApi<{ forks: Novel[] }>(`/api/novels/${id}/forks`);
    forks = forkData.forks;
  } catch {
    warnings.push("Failed to load forks.");
  }

  // Fetch world lines (needed for epoch voting + "Continue" badge)
  if (novel.active) {
    try {
      const wlData = await fetchApi<{ worldlines: { id: string }[] }>(`/api/novels/${id}/worldlines`);
      worldlines = wlData.worldlines;
    } catch {
      warnings.push("Failed to load world lines.");
    }
  }

  // Fetch round candidates for round voting (epoch_phase=0 + round Committing/Revealing)
  if (novel.active && novel.epoch_phase === 0 && (novel.round_phase === 1 || novel.round_phase === 2)) {
    try {
      const roundData = await fetchApi<{ chapters: typeof roundCandidates }>(`/api/novels/${id}/rounds/${novel.current_round}?epoch=${novel.current_epoch}`);
      roundCandidates = roundData.chapters;
    } catch {
      warnings.push("Failed to load round candidates.");
    }
  }

  // For epoch voting (epoch_phase=1 Committing or epoch_phase=2 Revealing), candidates are worldlines
  let epochCandidates: typeof roundCandidates = [];
  if (novel.active && (novel.epoch_phase === 1 || novel.epoch_phase === 2)) {
    epochCandidates = worldlines.map(wl => {
      const treeChapter = tree.find(c => c.id === wl.id);
      return {
        id: wl.id,
        author: treeChapter?.author || "",
        chapter_index: treeChapter?.chapter_index ?? 0,
        vote_count: treeChapter?.vote_count || "0",
        is_world_line: true,
        comment_count: 0,
      };
    });
  }

  // Compute votingRoundIds
  const roundVotingId = computeVotingRoundId(BigInt(id), novel.current_epoch, novel.current_round, false);
  const epochVotingId = computeVotingRoundId(BigInt(id), novel.current_epoch, novel.current_round, true);

  const phase = getPhaseLabel(novel.round_phase, novel.epoch_phase);

  const stakeEth = formatEth(novel.config.stakeAmount);
  const poolEth = formatEth(novel.pool_balance);
  const tippedEth = formatEth(novel.total_tipped);
  const estimatedRelease = Number(novel.pool_balance) > 0
    ? formatEth(String(BigInt(novel.pool_balance) * BigInt(novel.config.prizeReleaseRate) / BigInt(10000)))
    : "0";

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 pb-24 md:pb-8">
      {warnings.length > 0 && (
        <div className="mb-4 rounded-lg bg-yellow-900/20 border border-yellow-800 p-2 text-xs text-yellow-400">
          {warnings.map((w, i) => <p key={i}>{w}</p>)}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start gap-4 mb-6">
        {novel.cover_uri && (
          <img src={novel.cover_uri} alt="" className="w-24 h-32 object-cover rounded-lg bg-neutral-800" />
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold">{novel.title || `Novel #${novel.id}`}</h1>
          <p className="text-neutral-400 text-sm mt-1">
            by {shortenAddress(novel.creator)} · Novel #{novel.id}
          </p>
          {novel.description && (
            <p className="text-neutral-300 text-sm mt-2">{novel.description}</p>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <Badge variant={novel.active ? "default" : "secondary"}>
              {novel.active ? phase : "Completed"}
            </Badge>
            {novel.active && (
              <PhaseCountdown
                phaseStartTime={novel.phase_start_time}
                roundPhase={novel.round_phase}
                epochPhase={novel.epoch_phase}
                config={{
                  roundMinDuration: novel.config.roundMinDuration,
                  commitDuration: novel.config.commitDuration,
                  revealDuration: novel.config.revealDuration,
                }}
              />
            )}
            <span className="text-xs text-neutral-500">
              Round {novel.current_round} · Epoch {novel.current_epoch}
            </span>
            <span className="text-xs text-neutral-500">
              {novel.chapter_count ?? 0} chapters · {novel.author_count ?? 0} authors
            </span>
          </div>
        </div>
      </div>

      {/* Fork info */}
      {novel.fork_source_novel_id && (
        <div className="mb-4 rounded-lg bg-neutral-900 border border-neutral-800 p-3 text-sm">
          Forked from{" "}
          <Link href={`/novels/${novel.fork_source_novel_id}`} className="text-blue-400 hover:underline">
            Novel #{novel.fork_source_novel_id}
          </Link>
          {" "}Candidate(ID.{novel.fork_source_chapter_id})
        </div>
      )}

      {/* Prize Pool Module */}
      <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Prize Pool</h2>
          <TipButton novelId={id} />
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold text-amber-400">{poolEth} {TOKEN_SYMBOL}</p>
            <p className="text-xs text-neutral-500">Current Balance</p>
          </div>
          <div>
            <p className="text-lg font-semibold">{tippedEth} {TOKEN_SYMBOL}</p>
            <p className="text-xs text-neutral-500">Total Tipped</p>
          </div>
          <div>
            <p className="text-lg font-semibold">{estimatedRelease} {TOKEN_SYMBOL}</p>
            <p className="text-xs text-neutral-500">Next Epoch Release</p>
          </div>
        </div>
      </div>

      {/* Config collapsible */}
      <details className="rounded-lg bg-neutral-900 border border-neutral-800 p-4 mb-6">
        <summary className="font-semibold cursor-pointer">Configuration</summary>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3 text-sm">
          <div><span className="text-neutral-500">Chapter Length <FieldTooltip content="Min–Max content size in bytes. CJK characters are ~3 bytes each." /></span> {novel.config.minChapterLength}–{novel.config.maxChapterLength} bytes</div>
          <div><span className="text-neutral-500">Round Duration <FieldTooltip content="Minimum time the submission phase must last before it can close." /></span> {formatDuration(novel.config.roundMinDuration)}</div>
          <div><span className="text-neutral-500">Min Submissions <FieldTooltip content="Minimum chapter submissions required before voting. Must be >= World Line Count." /></span> {novel.config.roundMinSubmissions}</div>
          <div><span className="text-neutral-500">World Lines <FieldTooltip content="Parallel story branches kept each round. Top N voted chapters become world lines." /></span> {novel.config.worldLineCount}</div>
          <div><span className="text-neutral-500">Rounds/Epoch <FieldTooltip content="Rounds before Epoch voting. At epoch end, one world line is elected as Canon." /></span> {novel.config.roundsPerEpoch}</div>
          <div><span className="text-neutral-500">Commit Duration <FieldTooltip content="Time for voters to submit encrypted vote commitments." /></span> {formatDuration(novel.config.commitDuration)}</div>
          <div><span className="text-neutral-500">Reveal Duration <FieldTooltip content="Time for voters to reveal votes. Unrevealed votes are confiscated." /></span> {formatDuration(novel.config.revealDuration)}</div>
          <div><span className="text-neutral-500">Stake <FieldTooltip content="Anti-spam deposit. Normal losers get full refund; only spam-flagged authors lose 50%." /></span> {stakeEth} {TOKEN_SYMBOL}</div>
          <div><span className="text-neutral-500">Prize Release <FieldTooltip content="Percentage of the prize pool released each Epoch. Split into: creator royalty → author rewards → voter rewards." /></span> {novel.config.prizeReleaseRate / 100}%</div>
          <div><span className="text-neutral-500">Voter Reward <FieldTooltip content="Share of epoch rewards for voters. Higher = more voter incentive, less for authors. Accurate voters get 3x weight." /></span> {novel.config.voterRewardRate / 100}%</div>
          <div><span className="text-neutral-500">Strikes Before Slash <FieldTooltip content="Consecutive rounds in the bottom tier before 50% stake slash. Resets if the author skips a round or ranks higher." /></span> {novel.config.spamRounds}</div>
          <div><span className="text-neutral-500">Bottom Tier <FieldTooltip content="Authors ranking in the lowest X% each round receive a strike. Only tracked when 10+ submissions." /></span> {novel.config.spamThreshold}%</div>
          {novel.config.ruleQuorum != null && (
            <>
              <div><span className="text-neutral-500">Rule Proposal Fee <FieldTooltip content="Fee to propose a world-building rule (goes to prize pool)." /></span> {novel.config.ruleFee ? (Number(novel.config.ruleFee) / 1e18) : 0} {TOKEN_SYMBOL}</div>
              <div><span className="text-neutral-500">Rule Vote Quorum <FieldTooltip content="Canon-author votes needed to approve a rule proposal." /></span> {novel.config.ruleQuorum}</div>
              <div><span className="text-neutral-500">Rule Vote Duration <FieldTooltip content="Time window for canon authors to vote on a rule proposal." /></span> {formatDuration(novel.config.ruleVoteDuration)}</div>
            </>
          )}
        </div>
      </details>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Link href={`/novels/${id}/canon`}>
          <Button className="bg-amber-600 text-black font-semibold hover:bg-amber-500">Read the Story</Button>
        </Link>
      </div>

      {/* Phase transition — shown when phase timer has expired */}
      {novel.active && (
        <PhaseTransition
          novelId={id}
          roundPhase={novel.round_phase}
          epochPhase={novel.epoch_phase}
          phaseStartTime={novel.phase_start_time}
          config={{
            roundMinDuration: novel.config.roundMinDuration,
            commitDuration: novel.config.commitDuration,
            revealDuration: novel.config.revealDuration,
            roundMinSubmissions: novel.config.roundMinSubmissions,
          }}
          currentRoundSubmissions={tree.filter(c => c.round === novel.current_round).length}
        />
      )}

      {/* Round Vote Panel */}
      {novel.active && novel.epoch_phase === 0 && (novel.round_phase === 1 || novel.round_phase === 2) && roundCandidates.length > 0 && (
        <div className="mb-6">
          <VotePanel
            novelId={id}
            votingRoundId={roundVotingId}
            phase={novel.round_phase === 1 ? "committing" : "revealing"}
            candidates={roundCandidates}
            title={`Round ${novel.current_round} Vote — ${novel.round_phase === 1 ? "Commit" : "Reveal"}`}
          />
        </div>
      )}

      {/* Epoch Vote Panel */}
      {novel.active && (novel.epoch_phase === 1 || novel.epoch_phase === 2) && epochCandidates.length > 0 && (
        <div className="mb-6">
          <VotePanel
            novelId={id}
            votingRoundId={epochVotingId}
            phase={novel.epoch_phase === 1 ? "committing" : "revealing"}
            candidates={epochCandidates}
            title={`Epoch ${novel.current_epoch} Vote — Choose Canon — ${novel.epoch_phase === 1 ? "Commit" : "Reveal"}`}
          />
        </div>
      )}

      {/* Rewards Panel */}
      <div className="mb-6">
        <RewardsPanel novelId={id} />
      </div>

      {/* Story Tree */}
      {(tree.length > 0 || novel.current_epoch > 1) && (
        <div className="mb-6">
          <h2 className="font-semibold mb-3">Story Tree</h2>
          <ConnectedStoryTree initialChapters={tree} initialAnchors={treeAnchors} currentEpoch={novel.current_epoch} novelId={id} votingRoundId={novel.active && (novel.round_phase === 1 || novel.round_phase === 2) ? roundVotingId : undefined} continuable={novel.active && novel.epoch_phase === 0 && novel.round_phase === 0} activeWorldLineIds={new Set(worldlines.map(wl => wl.id))} forkSourceNovelId={novel.fork_source_novel_id} forkSourceChapterId={novel.fork_source_chapter_id} />
        </div>
      )}

      {/* Fork children */}
      {forks.length > 0 && (
        <div className="mb-6">
          <h2 className="font-semibold mb-3">Forks</h2>
          <div className="space-y-2">
            {forks.map(f => (
              <Link key={f.id} href={`/novels/${f.id}`} className="block rounded-lg bg-neutral-900 border border-neutral-800 p-3 hover:border-neutral-600 transition-colors">
                <span className="font-medium">{f.title || `Novel #${f.id}`}</span>
                <span className="text-neutral-500 text-sm ml-2">from Candidate(ID.{f.fork_source_chapter_id})</span>
                <Badge variant={f.active ? "default" : "secondary"} className="ml-2 text-xs">
                  {f.active ? "Active" : "Completed"}
                </Badge>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
