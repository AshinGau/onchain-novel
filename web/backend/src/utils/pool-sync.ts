import { query } from "../db/index.js";
import { prizePoolAbi } from "@onchain-novel/shared/chain";
import { env } from "./env.js";
import { createLogger } from "./logger.js";
import { createRpcPublicClient } from "./viem-client.js";

const log = createLogger("pool-sync");

export async function syncPoolBalances() {
  const client = createRpcPublicClient();
  const novels = await query("SELECT id FROM novels WHERE active = TRUE");

  for (const row of novels.rows) {
    try {
      const balance = await client.readContract({
        address: env.PRIZE_POOL_ADDRESS,
        abi: prizePoolAbi,
        functionName: "getPoolBalance",
        args: [BigInt(row.id)],
      });
      await query("UPDATE novels SET pool_balance = $1 WHERE id = $2", [
        balance.toString(),
        row.id,
      ]);
    } catch (err) {
      log.error({ err, novelId: row.id }, "Pool sync failed");
    }
  }
}
