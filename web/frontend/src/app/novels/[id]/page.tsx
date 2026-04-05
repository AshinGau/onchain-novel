import Link from "next/link";
import { notFound } from "next/navigation";
import { TipButton } from "@/components/tip-modal";
import { VotePanel } from "@/components/vote-panel";
import { RewardsPanel } from "@/components/rewards-panel";
import { fetchApi, type Novel, type TreeChapter, ROUND_PHASES, EPOCH_PHASES } from "@/lib/api";
import { TOKEN_SYMBOL } from "@/lib/config";
import { shortenAddress, formatEth } from "@/lib/format";
import { computeVotingRoundId } from "@/lib/contracts";
import { ConnectedStoryTree } from "@/components/connected-story-tree";
import { PhaseCountdown } from "@/components/phase-countdown";
import { PhaseTransition } from "@/components/phase-transition";

export default async function NovelDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let novel: Novel; let tree: TreeChapter[] = []; let forks: Novel[] = [];
  let worldlines: { id: string }[] = [];
  let roundCandidates: { id: string; author: string; chapter_index: number; vote_count: string; is_world_line: boolean; content_text?: string | null; comment_count?: string | number }[] = [];
  const warnings: string[] = [];

  try { novel = await fetchApi<Novel>(`/api/novels/${id}`); } catch { notFound(); }
  try { tree = (await fetchApi<{ chapters: TreeChapter[] }>(`/api/novels/${id}/tree`)).chapters; } catch { warnings.push("Failed to load story tree."); }
  try { forks = (await fetchApi<{ forks: Novel[] }>(`/api/novels/${id}/forks`)).forks; } catch { warnings.push("Failed to load forks."); }

  if (novel.active && (novel.epoch_phase === 1 || novel.epoch_phase === 2)) {
    try { worldlines = (await fetchApi<{ worldlines: { id: string }[] }>(`/api/novels/${id}/worldlines`)).worldlines; } catch { warnings.push("Failed to load world lines."); }
  }
  if (novel.active && novel.epoch_phase === 0 && (novel.round_phase === 1 || novel.round_phase === 2)) {
    try { roundCandidates = (await fetchApi<{ chapters: typeof roundCandidates }>(`/api/novels/${id}/rounds/${novel.current_round}`)).chapters; } catch { warnings.push("Failed to load round candidates."); }
  }

  let epochCandidates: typeof roundCandidates = [];
  if (novel.active && (novel.epoch_phase === 1 || novel.epoch_phase === 2)) {
    epochCandidates = worldlines.map(wl => {
      const tc = tree.find(c => c.id === wl.id);
      return { id: wl.id, author: tc?.author || "", chapter_index: tc?.chapter_index ?? 0, vote_count: tc?.vote_count || "0", is_world_line: true, comment_count: 0 };
    });
  }

  const roundVotingId = computeVotingRoundId(BigInt(id), novel.current_epoch, novel.current_round, false);
  const epochVotingId = computeVotingRoundId(BigInt(id), novel.current_epoch, novel.current_round, true);
  const phase = novel.epoch_phase === 0 ? ROUND_PHASES[novel.round_phase] : `Epoch ${EPOCH_PHASES[novel.epoch_phase]}`;
  const stakeEth = formatEth(novel.config.stakeAmount);
  const poolEth = formatEth(novel.pool_balance);
  const tippedEth = formatEth(novel.total_tipped);
  const estimatedRelease = Number(novel.pool_balance) > 0 ? formatEth(String(BigInt(novel.pool_balance) * BigInt(novel.config.prizeReleaseRate) / BigInt(10000))) : "0";

  return (
    <div className="container-lg py-4 pb-5">
      {warnings.length > 0 && <div className="alert alert-warning small py-2 mb-3">{warnings.map((w, i) => <p key={i} className="mb-0">{w}</p>)}</div>}

      {/* Header */}
      <div className="d-flex flex-column flex-md-row gap-3 mb-4">
        {novel.cover_uri && <img src={novel.cover_uri} alt="" className="rounded" style={{ width: 96, height: 128, objectFit: "cover" }} />}
        <div className="flex-grow-1">
          <h2 className="fw-bold">{novel.title || `Novel #${novel.id}`}</h2>
          <p className="text-body-secondary small">by {shortenAddress(novel.creator)} &middot; Novel #{novel.id}</p>
          {novel.description && <p className="small">{novel.description}</p>}
          <div className="d-flex flex-wrap align-items-center gap-2">
            <span className={`badge ${novel.active ? "bg-primary" : "bg-secondary"}`}>{novel.active ? phase : "Completed"}</span>
            {novel.active && <PhaseCountdown phaseStartTime={novel.phase_start_time} roundPhase={novel.round_phase} epochPhase={novel.epoch_phase}
              config={{ roundMinDuration: novel.config.roundMinDuration, commitDuration: novel.config.commitDuration, revealDuration: novel.config.revealDuration }} />}
            <span className="small text-body-tertiary">Round {novel.current_round} &middot; Epoch {novel.current_epoch}</span>
            <span className="small text-body-tertiary">{novel.chapter_count ?? 0} chapters &middot; {novel.author_count ?? 0} authors</span>
          </div>
        </div>
      </div>

      {/* Fork info */}
      {novel.fork_source_novel_id && (
        <div className="card card-body small mb-3">Forked from <Link href={`/novels/${novel.fork_source_novel_id}`} className="link-primary">Novel #{novel.fork_source_novel_id}</Link> Candidate(ID.{novel.fork_source_chapter_id})</div>
      )}

      {/* Prize Pool */}
      <div className="card mb-3"><div className="card-body">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h5 className="card-title mb-0">Prize Pool</h5>
          <TipButton novelId={id} />
        </div>
        <div className="row text-center g-3">
          <div className="col-4"><p className="fs-4 fw-bold text-warning mb-0">{poolEth} {TOKEN_SYMBOL}</p><p className="small text-body-tertiary mb-0">Current Balance</p></div>
          <div className="col-4"><p className="fs-5 fw-semibold mb-0">{tippedEth} {TOKEN_SYMBOL}</p><p className="small text-body-tertiary mb-0">Total Tipped</p></div>
          <div className="col-4"><p className="fs-5 fw-semibold mb-0">{estimatedRelease} {TOKEN_SYMBOL}</p><p className="small text-body-tertiary mb-0">Next Epoch Release</p></div>
        </div>
      </div></div>

      {/* Config */}
      <details className="card mb-3"><summary className="card-header fw-semibold" role="button">Configuration</summary>
        <div className="card-body"><div className="row row-cols-2 row-cols-md-3 g-2 small">
          <div className="col"><span className="text-body-secondary">Stake:</span> {stakeEth} {TOKEN_SYMBOL}</div>
          <div className="col"><span className="text-body-secondary">World Lines:</span> {novel.config.worldLineCount}</div>
          <div className="col"><span className="text-body-secondary">Rounds/Epoch:</span> {novel.config.roundsPerEpoch}</div>
          <div className="col"><span className="text-body-secondary">Min Submissions:</span> {novel.config.roundMinSubmissions}</div>
          <div className="col"><span className="text-body-secondary">Prize Release:</span> {novel.config.prizeReleaseRate / 100}%</div>
          <div className="col"><span className="text-body-secondary">Voter Reward:</span> {novel.config.voterRewardRate / 100}%</div>
          <div className="col"><span className="text-body-secondary">Chapter Length:</span> {novel.config.minChapterLength}–{novel.config.maxChapterLength} bytes</div>
        </div></div>
      </details>

      {/* Actions */}
      <div className="d-flex gap-2 mb-3">
        <Link href={`/novels/${id}/canon`} className="btn btn-warning">Read the Story</Link>
      </div>

      {novel.active && <PhaseTransition novelId={id} roundPhase={novel.round_phase} epochPhase={novel.epoch_phase} phaseStartTime={novel.phase_start_time}
        config={{ roundMinDuration: novel.config.roundMinDuration, commitDuration: novel.config.commitDuration, revealDuration: novel.config.revealDuration, roundMinSubmissions: novel.config.roundMinSubmissions }}
        currentRoundSubmissions={tree.filter(c => c.round === novel.current_round).length} />}

      {novel.active && novel.epoch_phase === 0 && (novel.round_phase === 1 || novel.round_phase === 2) && roundCandidates.length > 0 && (
        <div className="mb-3"><VotePanel novelId={id} votingRoundId={roundVotingId} phase={novel.round_phase === 1 ? "committing" : "revealing"} candidates={roundCandidates}
          title={`Round ${novel.current_round} Vote — ${novel.round_phase === 1 ? "Commit" : "Reveal"}`} /></div>
      )}
      {novel.active && (novel.epoch_phase === 1 || novel.epoch_phase === 2) && epochCandidates.length > 0 && (
        <div className="mb-3"><VotePanel novelId={id} votingRoundId={epochVotingId} phase={novel.epoch_phase === 1 ? "committing" : "revealing"} candidates={epochCandidates}
          title={`Epoch ${novel.current_epoch} Vote — Choose Canon — ${novel.epoch_phase === 1 ? "Commit" : "Reveal"}`} /></div>
      )}

      <div className="mb-3"><RewardsPanel novelId={id} /></div>

      {tree.length > 0 && <div className="mb-3"><h5 className="fw-semibold mb-2">Story Tree</h5>
        <ConnectedStoryTree chapters={tree} novelId={id} votingRoundId={novel.active && (novel.round_phase === 1 || novel.round_phase === 2) ? roundVotingId : undefined} /></div>}

      {forks.length > 0 && <div className="mb-3"><h5 className="fw-semibold mb-2">Forks</h5>
        <div className="list-group">{forks.map(f => (
          <Link key={f.id} href={`/novels/${f.id}`} className="list-group-item list-group-item-action d-flex justify-content-between align-items-center">
            <span><strong>{f.title || `Novel #${f.id}`}</strong> <span className="text-body-secondary small">from Candidate(ID.{f.fork_source_chapter_id})</span></span>
            <span className={`badge ${f.active ? "bg-primary" : "bg-secondary"}`}>{f.active ? "Active" : "Completed"}</span>
          </Link>
        ))}</div></div>}
    </div>
  );
}
