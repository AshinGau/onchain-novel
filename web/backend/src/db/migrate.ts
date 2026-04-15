import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { createLogger } from "../utils/logger.js";
import pool from "./index.js";

const log = createLogger("migrate");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const migrationsDir = path.resolve(__dirname, "../../migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    log.info({ file }, "Running migration");
    await pool.query(sql);
  }

  log.info("Migrations complete");
  await pool.end();
}

migrate().catch((err) => {
  log.error({ err }, "Migration failed");
  process.exit(1);
});
