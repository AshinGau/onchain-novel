import { Command } from "commander";

import { requireConfig } from "../utils/config.js";
import { error, header, success } from "../utils/format.js";

/**
 * Call a backend admin endpoint (DELETE or POST) and handle errors uniformly.
 * All admin endpoints are localhost-only — running from a remote machine will
 * return 403 with a clear error message.
 */
async function adminFetch(method: "DELETE" | "POST", path: string, label: string): Promise<void> {
  const cfg = requireConfig();
  const url = `${cfg.apiUrl}${path}`;
  header(label);

  try {
    const res = await fetch(url, { method });
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;

    if (!res.ok) {
      error(`Backend returned ${res.status}: ${body.error ?? "unknown error"}`);
      process.exit(1);
    }

    const id = body.deleted ?? body.restored;
    success(`${label} — Novel #${id}. On-chain data is unchanged.`);
  } catch (err) {
    error(`Could not reach backend at ${cfg.apiUrl}: ${String(err)}`);
    process.exit(1);
  }
}

export function registerAdminCommands(program: Command): void {
  const admin = program
    .command("admin")
    .description("Admin commands (localhost-only backend calls)");

  admin
    .command("delete-novel <novel-id>")
    .description("Hide a novel and all its chapters from the frontend.")
    .action(async (novelId) => {
      await adminFetch("DELETE", `/api/admin/novels/${novelId}`, `Delete Novel #${novelId}`);
    });

  admin
    .command("restore-novel <novel-id>")
    .description("Restore a previously hidden novel and its chapters.")
    .action(async (novelId) => {
      await adminFetch("POST", `/api/admin/novels/${novelId}/restore`, `Restore Novel #${novelId}`);
    });
}
