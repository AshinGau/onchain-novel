import type pg from "pg";

interface NotificationInput {
  recipient: string | null; // null = broadcast (for all participants of a novel)
  novelId: string;
  type: string;
  title: string;
  message: string;
  link?: string;
}

export async function createNotification(db: pg.PoolClient | pg.Pool, input: NotificationInput) {
  await db.query(
    `INSERT INTO notifications (recipient, novel_id, type, title, message, link)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.recipient, input.novelId, input.type, input.title, input.message, input.link || null]
  );
}

/**
 * Create reveal reminders for all voters who committed but haven't revealed yet.
 * Called when a round/epoch enters the Revealing phase.
 */
export async function createRevealReminders(db: pg.PoolClient, novelId: string, votingRoundId: string, novelTitle: string) {
  const unrevealedRes = await db.query(
    "SELECT DISTINCT voter FROM votes WHERE novel_id = $1 AND voting_round_id = $2 AND revealed = FALSE",
    [novelId, votingRoundId]
  );

  for (const row of unrevealedRes.rows) {
    await createNotification(db, {
      recipient: row.voter,
      novelId,
      type: "reveal_reminder",
      title: "Reveal your vote!",
      message: `The reveal phase has started for "${novelTitle || `Novel #${novelId}`}". Reveal your vote to avoid losing your stake.`,
      link: `/novels/${novelId}`,
    });
  }
}
