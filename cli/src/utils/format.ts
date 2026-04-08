import chalk from "chalk";
import { formatEther } from "viem";

/** Print a labeled key-value pair */
export function kv(label: string, value: unknown): void {
  console.log(`  ${chalk.gray(label + ":")} ${value}`);
}

/** Print a section header */
export function header(text: string): void {
  console.log(chalk.bold.cyan(`\n${text}`));
  console.log(chalk.gray("─".repeat(60)));
}

/** Print success message */
export function success(msg: string): void {
  console.log(chalk.green(`\u2713 ${msg}`));
}

/** Print error message */
export function error(msg: string): void {
  console.error(chalk.red(`\u2717 ${msg}`));
}

/** Print a transaction hash with label */
export function txHash(hash: string): void {
  console.log(chalk.green(`\u2713 Transaction sent: ${hash}`));
}

/** Format wei to ETH string */
export function eth(wei: bigint | string): string {
  const val = typeof wei === "string" ? BigInt(wei) : wei;
  return `${formatEther(val)} ETH`;
}

/** Print a simple table from array of objects */
export function table(rows: Record<string, unknown>[], columns?: string[]): void {
  if (rows.length === 0) {
    console.log(chalk.gray("  (no results)"));
    return;
  }
  const cols = columns ?? Object.keys(rows[0]);
  // Calculate column widths
  const widths = cols.map((col) =>
    Math.max(col.length, ...rows.map((r) => String(r[col] ?? "").length)),
  );
  // Header
  const headerLine = cols.map((col, i) => col.padEnd(widths[i])).join("  ");
  console.log(chalk.bold("  " + headerLine));
  console.log(chalk.gray("  " + widths.map((w) => "─".repeat(w)).join("  ")));
  // Rows
  for (const row of rows) {
    const line = cols.map((col, i) => String(row[col] ?? "").padEnd(widths[i])).join("  ");
    console.log("  " + line);
  }
}

/** Parse duration string like "7d", "24h", "30m", "3600s" to seconds */
export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}. Use <number>(s|m|h|d), e.g., 7d, 24h`);
  }
  const value = parseInt(match[1]);
  const unit = match[2];
  switch (unit) {
    case "s": return value;
    case "m": return value * 60;
    case "h": return value * 3600;
    case "d": return value * 86400;
    default: throw new Error(`Unknown unit: ${unit}`);
  }
}

/** Round phase name from numeric value */
export function roundPhaseName(phase: number): string {
  switch (phase) {
    case 0: return "Idle";
    case 1: return "Nominating";
    case 2: return "Committing";
    case 3: return "Revealing";
    default: return `Unknown(${phase})`;
  }
}
