"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toHex } from "viem";
import { useAccount, useReadContract } from "wagmi";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTxAction } from "@/hooks/use-tx-action";
import {
  fetchChapter,
  fetchNickname,
  fetchNovel,
  fetchUserChapters,
  fetchUserRewards,
  fetchUserVotes,
  type RewardSummary,
  type UserChapter,
  type UserVote,
} from "@/lib/api";
import {
  NOVEL_CORE_ADDRESS,
  novelCoreAbi,
  PRIZE_POOL_ADDRESS,
  prizePoolAbi,
  USER_REGISTRY_ADDRESS,
  userRegistryAbi,
} from "@/lib/contracts";
import { formatBalance, formatEth, shortAddress, timeAgo } from "@/lib/format";
import { deleteBookmark, getBookmarks, type Bookmark } from "@/lib/reading-storage";

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const [chapters, setChapters] = useState<UserChapter[]>([]);
  const [votes, setVotes] = useState<UserVote[]>([]);
  const [rewards, setRewards] = useState<RewardSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Nickname
  const [nickname, setNickname] = useState("");
  const [currentNickname, setCurrentNickname] = useState<string | null>(null);
  const [showNicknameEdit, setShowNicknameEdit] = useState(false);
  const nicknameTx = useTxAction();

  // Draft count (localStorage)
  const [draftCount, setDraftCount] = useState(0);
  useEffect(() => {
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) {
      if (localStorage.key(i)?.startsWith("draft:")) n++;
    }
    setDraftCount(n);
  }, []);

  // Bookmarks (localStorage)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  useEffect(() => {
    setBookmarks(getBookmarks());
  }, []);
  function handleDeleteBookmark(leafId: string) {
    if (!window.confirm("Delete this bookmark?")) return;
    deleteBookmark(leafId);
    setBookmarks(getBookmarks());
  }

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    setFetchError(null);
    Promise.all([
      fetchUserChapters(address),
      fetchUserVotes(address),
      fetchUserRewards(address),
      fetchNickname(address),
    ])
      .then(([chData, voteData, rewardData, nicknameData]) => {
        setChapters(chData.chapters || []);
        setVotes(voteData.votes || []);
        setRewards(rewardData);
        setCurrentNickname(nicknameData.nickname);
      })
      .catch((err) => {
        setFetchError(`Failed to load dashboard data: ${err.message}`);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [address]);

  function handleSetNickname() {
    if (!nickname.trim()) return;
    const bytes = new TextEncoder().encode(nickname.trim());
    if (bytes.length > 32) {
      alert("Nickname must be 32 bytes or less.");
      return;
    }
    // Pad to 32 bytes
    const padded = new Uint8Array(32);
    padded.set(bytes);
    const hex = toHex(padded) as `0x${string}`;

    nicknameTx.send(
      {
        address: USER_REGISTRY_ADDRESS,
        abi: userRegistryAbi,
        functionName: "setNickname",
        args: [hex],
      },
      () => {
        setCurrentNickname(nickname.trim());
      },
    );
  }

  const pendingReveals = votes.filter((v) => !v.revealed && !v.claimed && v.round_phase === 3);
  const canEditNickname = isConnected && !currentNickname;

  return (
    <div className="on-container" style={{ maxWidth: "1000px" }}>
      {/* Compact header */}
      <div className="on-row-between" style={{ marginBottom: "1rem", alignItems: "center" }}>
        <div className="on-row" style={{ gap: "0.75rem", alignItems: "baseline" }}>
          <h1 className="text-heading" style={{ margin: 0 }}>
            My Dashboard
          </h1>
          {isConnected && (
            <span className="text-caption text-muted">
              {currentNickname ? `${currentNickname} · ` : ""}
              {shortAddress(address!)}
            </span>
          )}
        </div>
        <div className="on-row" style={{ gap: "0.5rem" }}>
          {!isConnected && <ConnectButton />}
          {canEditNickname && (
            <button
              type="button"
              onClick={() => setShowNicknameEdit(!showNicknameEdit)}
              title="Set display name"
              aria-label="Set display name"
              style={{
                width: "2rem",
                height: "2rem",
                borderRadius: "0.375rem",
                border: "1px solid var(--color-border)",
                background: "var(--color-bg)",
                cursor: "pointer",
                fontSize: "1rem",
                lineHeight: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ⚙
            </button>
          )}
        </div>
      </div>

      {/* Nickname edit panel — hidden behind ⚙ */}
      {canEditNickname && showNicknameEdit && (
        <div className="on-card" style={{ marginBottom: "1rem" }}>
          <h3 className="text-subheading" style={{ marginBottom: "0.5rem" }}>
            Set Display Name
          </h3>
          <p className="text-tiny text-muted" style={{ marginBottom: "0.5rem" }}>
            Choose carefully — your display name cannot be changed once set.
          </p>
          <div className="on-row">
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Your nickname (max 32 bytes)"
              maxLength={32}
              className="on-form-input"
              style={{ flex: 1 }}
            />
            <button
              onClick={handleSetNickname}
              disabled={nicknameTx.isPending || !nickname.trim()}
              className="on-btn on-btn-primary"
            >
              {nicknameTx.isPending
                ? "Saving..."
                : nicknameTx.status === "success"
                  ? "Saved!"
                  : "Save"}
            </button>
          </div>
          <p className="text-tiny" style={{ marginTop: "0.25rem" }}>
            {new TextEncoder().encode(nickname).length}/32 bytes
          </p>
          {nicknameTx.error && (
            <p className="text-danger" style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>
              {nicknameTx.error}
            </p>
          )}
        </div>
      )}

      {fetchError && (
        <div
          className="on-card"
          style={{
            borderColor: "var(--color-danger)",
            color: "var(--color-danger)",
            marginBottom: "1rem",
          }}
        >
          {fetchError}
        </div>
      )}

      {/* Urgent: pending reveals */}
      {pendingReveals.length > 0 && (
        <div
          className="on-card"
          style={{ borderColor: "var(--color-warning)", marginBottom: "1rem" }}
        >
          <h2 className="text-subheading" style={{ color: "var(--color-warning)" }}>
            Action Required: Reveal Your Votes
          </h2>
          <p className="text-caption">
            You have {pendingReveals.length} vote(s) waiting to be revealed. Unrevealed votes will
            be forfeited.
          </p>
          {pendingReveals.map((v) => (
            <Link
              key={`${v.novel_id}-${v.round}`}
              href={`/novels/${v.novel_id}`}
              className="text-link"
              style={{ display: "block" }}
            >
              {v.novel_title || `Novel #${v.novel_id}`}
            </Link>
          ))}
        </div>
      )}

      <Tabs defaultValue="bookmarks">
        <TabsList>
          <TabsTrigger value="bookmarks">Bookmarks ({bookmarks.length})</TabsTrigger>
          <TabsTrigger value="chapters">
            My Chapters ({isConnected ? chapters.length : "·"})
          </TabsTrigger>
          <TabsTrigger value="votes">My Votes ({isConnected ? votes.length : "·"})</TabsTrigger>
          <TabsTrigger value="rewards">
            Rewards ({isConnected ? (rewards?.participatedNovels.length ?? 0) : "·"})
          </TabsTrigger>
          <TabsTrigger value="drafts">Drafts ({draftCount})</TabsTrigger>
        </TabsList>

        <TabsContent value="bookmarks">
          {bookmarks.length === 0 ? (
            <p className="text-caption on-empty">
              No bookmarks yet. Open a storyline in the reader to save your progress.
            </p>
          ) : (
            <div className="on-table-wrap" style={{ marginTop: "0.75rem" }}>
              <table className="on-table">
                <thead>
                  <tr>
                    <th>Novel</th>
                    <th>Last Chapter</th>
                    <th className="num">Progress</th>
                    <th>Updated</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {bookmarks.map((b) => (
                    <tr key={b.leafId}>
                      <td>
                        <Link href={`/novels/${b.novelId}`} className="cell-title text-link">
                          {b.novelTitle || `Novel #${b.novelId}`}
                        </Link>
                      </td>
                      <td>
                        <Link
                          href={`/novels/${b.novelId}/chapter/${b.leafId}`}
                          className="text-link on-table-mono"
                        >
                          ID.{b.leafId}
                        </Link>
                      </td>
                      <td className="num">Chapter {b.depth}</td>
                      <td className="text-muted">
                        {timeAgo(Math.floor(b.updatedAt / 1000).toString())}
                      </td>
                      <td style={{ display: "flex", gap: "0.5rem" }}>
                        <Link
                          href={`/novels/${b.novelId}/read/${b.leafId}?depth=${b.depth}`}
                          className="on-btn-soft"
                        >
                          Continue
                        </Link>
                        <button
                          type="button"
                          className="on-btn-soft-danger"
                          onClick={() => handleDeleteBookmark(b.leafId)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {!isConnected ? (
          <>
            <TabsContent value="chapters">
              <ConnectPrompt label="your chapters" />
            </TabsContent>
            <TabsContent value="votes">
              <ConnectPrompt label="your votes" />
            </TabsContent>
            <TabsContent value="rewards">
              <ConnectPrompt label="your rewards" />
            </TabsContent>
          </>
        ) : loading ? (
          <TabsContent value="chapters">
            <p className="text-caption">Loading...</p>
          </TabsContent>
        ) : (
          <>
            <TabsContent value="chapters">
              {chapters.length === 0 ? (
                <p className="text-caption on-empty">No chapters submitted yet.</p>
              ) : (
                <div className="on-table-wrap" style={{ marginTop: "0.75rem" }}>
                  <table className="on-table">
                    <thead>
                      <tr>
                        <th>Novel</th>
                        <th>Chapter ID</th>
                        <th>Chapter Index</th>
                        <th>Status</th>
                        <th className="num">Comments</th>
                        <th className="num">Votes Received</th>
                        <th>Submitted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chapters.map((ch) => (
                        <tr key={ch.id}>
                          <td>
                            <Link href={`/novels/${ch.novel_id}`} className="cell-title text-link">
                              {ch.novel_title || `Novel #${ch.novel_id}`}
                            </Link>
                          </td>
                          <td>
                            <Link
                              href={`/novels/${ch.novel_id}/chapter/${ch.id}`}
                              className="text-link on-table-mono"
                            >
                              ID.{ch.id}
                            </Link>
                          </td>
                          <td className="num">#{ch.depth}</td>
                          <td>
                            {ch.is_world_line ? (
                              <span className="on-badge badge-worldline">World Line</span>
                            ) : (
                              <span
                                className="on-badge"
                                style={{
                                  background: "var(--color-bg-tertiary)",
                                  color: "var(--color-text-secondary)",
                                }}
                              >
                                Branch
                              </span>
                            )}
                          </td>
                          <td className="num">{ch.comment_count ?? 0}</td>
                          <td className="num">{ch.vote_count ?? 0}</td>
                          <td className="text-muted">{timeAgo(ch.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="votes">
              {votes.length === 0 ? (
                <p className="text-caption on-empty">No votes cast yet.</p>
              ) : (
                <div className="on-table-wrap" style={{ marginTop: "0.75rem" }}>
                  <table className="on-table">
                    <thead>
                      <tr>
                        <th>Novel</th>
                        <th>Round</th>
                        <th>Voted For</th>
                        <th>Phase</th>
                        <th>Status</th>
                        <th className="num">Committed @</th>
                      </tr>
                    </thead>
                    <tbody>
                      {votes.map((v, i) => (
                        <tr key={i}>
                          <td>
                            <Link href={`/novels/${v.novel_id}`} className="cell-title text-link">
                              {v.novel_title || `Novel #${v.novel_id}`}
                            </Link>
                          </td>
                          <td className="on-table-mono">R{v.round}</td>
                          <td>
                            {v.candidate_id ? (
                              <Link
                                href={`/novels/${v.novel_id}/chapter/${v.candidate_id}`}
                                className="text-link on-table-mono"
                              >
                                ID.{v.candidate_id}
                              </Link>
                            ) : (
                              <span className="text-muted">Hidden</span>
                            )}
                          </td>
                          <td className="text-muted" style={{ fontSize: "0.8125rem" }}>
                            {phaseLabel(v.round_phase)}
                          </td>
                          <td>
                            {!v.revealed && (
                              <span
                                className="on-badge"
                                style={{ background: "var(--color-danger)", color: "white" }}
                              >
                                Unrevealed
                              </span>
                            )}
                            {v.revealed && !v.claimed && (
                              <span className="on-badge badge-active">Revealed</span>
                            )}
                            {v.claimed && <span className="on-badge badge-completed">Claimed</span>}
                          </td>
                          <td className="num text-muted on-table-mono">#{v.commit_block}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="rewards">
              {!rewards ? (
                <p className="text-caption on-empty">Loading rewards...</p>
              ) : rewards.participatedNovels.length === 0 ? (
                <p className="text-caption on-empty">
                  No reward activity yet. Participate in a novel to earn rewards.
                </p>
              ) : (
                <div className="on-stack" style={{ marginTop: "0.75rem" }}>
                  <h3 className="on-section-title">
                    Pending Rewards
                    <span className="count">{rewards.participatedNovels.length}</span>
                  </h3>
                  <div className="on-table-wrap">
                    <table className="on-table">
                      <thead>
                        <tr>
                          <th>Novel</th>
                          <th className="num">Chapters Authored</th>
                          <th>Contributing Chapters</th>
                          <th className="num">Pending</th>
                          <th className="num">Lifetime Claimed</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rewards.participatedNovels.map((pn) => {
                          const mine = chapters.filter((c) => c.novel_id === pn.novel_id);
                          const claimedSum = rewards.rewardClaims
                            .filter((rc) => rc.novel_id === pn.novel_id)
                            .reduce((s, rc) => s + BigInt(rc.amount), BigInt(0));
                          return (
                            <RewardsRow
                              key={pn.novel_id}
                              novelId={pn.novel_id}
                              title={pn.novel_title}
                              chaptersInNovel={mine}
                              lifetimeClaimed={claimedSum}
                            />
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <h3 className="on-section-title">
                    Claim History
                    <span className="count">{rewards.rewardClaims.length}</span>
                  </h3>
                  {rewards.rewardClaims.length === 0 ? (
                    <p className="text-caption on-empty">No claims yet.</p>
                  ) : (
                    <div className="on-table-wrap">
                      <table className="on-table">
                        <thead>
                          <tr>
                            <th>Novel</th>
                            <th>Source</th>
                            <th>Round</th>
                            <th className="num">Amount</th>
                            <th>Block</th>
                            <th>Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rewards.rewardClaims.map((rc, i) => (
                            <tr key={i}>
                              <td>
                                <Link
                                  href={`/novels/${rc.novel_id}`}
                                  className="cell-title text-link"
                                >
                                  {rc.novel_title || `Novel #${rc.novel_id}`}
                                </Link>
                              </td>
                              <td>
                                <span
                                  className="on-badge"
                                  style={{
                                    background: "var(--color-bg-tertiary)",
                                    color: "var(--color-text-secondary)",
                                  }}
                                >
                                  {rc.source}
                                </span>
                              </td>
                              <td className="on-table-mono">
                                {rc.round != null ? `R${rc.round}` : "—"}
                              </td>
                              <td className="on-table-amount">{formatEth(rc.amount)}</td>
                              <td className="text-muted on-table-mono">#{rc.block_number}</td>
                              <td className="text-muted">{timeAgo(rc.created_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
          </>
        )}

        <TabsContent value="drafts">
          <DraftsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ConnectPrompt({ label }: { label: string }) {
  return (
    <div className="on-card on-text-center" style={{ padding: "2rem 1rem" }}>
      <p className="text-caption" style={{ marginBottom: "0.75rem" }}>
        Connect your wallet to view {label}.
      </p>
      <ConnectButton />
    </div>
  );
}

function phaseLabel(phase: number): string {
  // Mirrors contract enum DataTypes.RoundPhase exactly.
  const labels = ["Idle", "Nominating", "Committing", "Revealing"];
  const label = labels[phase];
  if (!label) throw new Error(`Unknown round phase: ${phase}`);
  return label;
}

function RewardsRow({
  novelId,
  title,
  chaptersInNovel,
  lifetimeClaimed,
}: {
  novelId: string;
  title: string;
  chaptersInNovel: UserChapter[];
  lifetimeClaimed: bigint;
}) {
  const { address } = useAccount();

  const { data: pendingReward } = useReadContract({
    address: PRIZE_POOL_ADDRESS,
    abi: prizePoolAbi,
    functionName: "getPendingReward",
    args: address ? [BigInt(novelId), address] : undefined,
    query: { enabled: !!address },
  });

  const hasPending = pendingReward !== undefined && pendingReward > BigInt(0);
  const claimTx = useTxAction();

  const contributing = chaptersInNovel.filter((c) => c.is_world_line);
  const contribList = contributing.length > 0 ? contributing : chaptersInNovel;

  return (
    <tr>
      <td>
        <Link href={`/novels/${novelId}`} className="cell-title text-link">
          {title || `Novel #${novelId}`}
        </Link>
      </td>
      <td className="num">{chaptersInNovel.length}</td>
      <td>
        {contribList.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
            {contribList.slice(0, 5).map((c) => (
              <Link
                key={c.id}
                href={`/novels/${novelId}/chapter/${c.id}`}
                className="on-badge on-table-mono"
                style={{
                  background: c.is_world_line
                    ? "color-mix(in srgb, var(--color-primary) 12%, transparent)"
                    : "var(--color-bg-tertiary)",
                  color: c.is_world_line ? "var(--color-primary)" : "var(--color-text-secondary)",
                  textDecoration: "none",
                }}
              >
                ID.{c.id}
              </Link>
            ))}
            {contribList.length > 5 && (
              <span className="text-muted text-tiny">+{contribList.length - 5}</span>
            )}
          </div>
        )}
      </td>
      <td
        className="num"
        style={{
          color: hasPending ? "var(--color-warning)" : "var(--color-text-muted)",
          fontWeight: hasPending ? 600 : 400,
        }}
      >
        {pendingReward !== undefined ? formatBalance(pendingReward.toString()) : "…"}
      </td>
      <td
        className="num"
        style={{
          color: lifetimeClaimed > BigInt(0) ? "var(--color-success)" : "var(--color-text-muted)",
        }}
      >
        {lifetimeClaimed > BigInt(0) ? formatEth(lifetimeClaimed.toString()) : "—"}
      </td>
      <td>
        {hasPending ? (
          <button
            className="on-btn-soft"
            disabled={claimTx.isPending}
            onClick={() =>
              claimTx.send({
                address: NOVEL_CORE_ADDRESS,
                abi: novelCoreAbi,
                functionName: "claimReward",
                args: [BigInt(novelId)],
              })
            }
          >
            {claimTx.isPending ? "Claiming…" : claimTx.status === "success" ? "Claimed ✓" : "Claim"}
          </button>
        ) : (
          <span className="text-muted">—</span>
        )}
        {claimTx.error && (
          <div className="text-danger" style={{ fontSize: "0.7rem", marginTop: "0.25rem" }}>
            {claimTx.error}
          </div>
        )}
      </td>
    </tr>
  );
}

interface DraftRow {
  key: string;
  novelId: string;
  parentId: string;
  preview: string;
  size: number;
  novelTitle?: string;
  parentDepth?: number;
}

function DraftsTab() {
  const [drafts, setDrafts] = useState<DraftRow[]>([]);

  useEffect(() => {
    const found: DraftRow[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("draft:")) {
        const parts = key.split(":");
        const novelId = parts[1];
        const parentId = parts[2];
        const content = localStorage.getItem(key) || "";
        found.push({
          key,
          novelId,
          parentId,
          preview: content.slice(0, 120),
          size: new TextEncoder().encode(content).length,
        });
      }
    }
    setDrafts(found);

    // Enrich with novel title and parent chapter depth
    const novelIds = [...new Set(found.map((d) => d.novelId))];
    const parentIds = [...new Set(found.map((d) => d.parentId))];
    Promise.all([
      ...novelIds.map((id) =>
        fetchNovel(id)
          .then((n) => ({ id, title: n.title }))
          .catch(() => null),
      ),
      ...parentIds.map((id) =>
        fetchChapter(id)
          .then((c) => ({ id, depth: c.depth }))
          .catch(() => null),
      ),
    ]).then((results) => {
      const titles: Record<string, string> = {};
      const depths: Record<string, number> = {};
      for (const r of results) {
        if (!r) continue;
        if ("title" in r) titles[r.id] = r.title;
        if ("depth" in r) depths[r.id] = r.depth;
      }
      setDrafts((prev) =>
        prev.map((d) => ({
          ...d,
          novelTitle: titles[d.novelId],
          parentDepth: depths[d.parentId],
        })),
      );
    });
  }, []);

  function deleteDraft(key: string) {
    if (!window.confirm("Delete this draft? This cannot be undone.")) return;
    localStorage.removeItem(key);
    setDrafts((prev) => prev.filter((d) => d.key !== key));
  }

  if (drafts.length === 0) {
    return <p className="text-caption on-empty">No drafts saved.</p>;
  }

  return (
    <div className="on-table-wrap" style={{ marginTop: "0.75rem" }}>
      <table className="on-table">
        <thead>
          <tr>
            <th>Novel</th>
            <th>Parent ID</th>
            <th>Parent Chapter Index</th>
            <th>Preview</th>
            <th className="num">Size</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {drafts.map((d) => (
            <tr key={d.key}>
              <td>
                <Link href={`/novels/${d.novelId}`} className="cell-title text-link">
                  {d.novelTitle || `Novel #${d.novelId}`}
                </Link>
              </td>
              <td>
                <Link
                  href={`/novels/${d.novelId}/chapter/${d.parentId}`}
                  className="text-link on-table-mono"
                >
                  ID.{d.parentId}
                </Link>
              </td>
              <td className="num">
                {d.parentDepth != null ? (
                  `#${d.parentDepth}`
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td className="text-muted" style={{ maxWidth: "28rem" }}>
                <div className="text-truncate">{d.preview || <em>(empty)</em>}</div>
              </td>
              <td className="num text-muted">{d.size} B</td>
              <td style={{ display: "flex", gap: "0.5rem" }}>
                <Link href={`/novels/${d.novelId}/chapter/${d.parentId}`} className="on-btn-soft">
                  Continue
                </Link>
                <button onClick={() => deleteDraft(d.key)} className="on-btn-soft-danger">
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
