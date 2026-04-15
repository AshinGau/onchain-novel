import { readFileSync, statSync } from "node:fs";
import chalk from "chalk";

/**
 * Resolve chapter content from either --content or --file, enforcing mutual
 * exclusion. Returns the raw UTF-8 string. Callers pass it to
 * `buildContentSubmission`, which hashes + encodes.
 */
export function resolveContent(opts: { content?: string; file?: string }): string {
  if (opts.content && opts.file) {
    throw new Error("Pass only one of --content or --file, not both.");
  }
  if (!opts.content && !opts.file) {
    throw new Error("Missing chapter content. Pass --content <text> or --file <path>.");
  }
  if (opts.file) {
    const st = statSync(opts.file);
    if (!st.isFile()) throw new Error(`--file ${opts.file} is not a regular file.`);
    return readFileSync(opts.file, "utf-8");
  }
  return opts.content!;
}

/**
 * Warn — but do not block — if content byte-length falls outside the novel's
 * configured min/max range. The contract will revert; we print a hint first so
 * the user can cancel before paying gas.
 */
export function warnIfOutOfRange(
  content: string,
  cfg: { minChapterLength?: string; maxChapterLength?: string } | undefined,
): void {
  if (!cfg) return;
  const bytes = Buffer.byteLength(content, "utf-8");
  const min = cfg.minChapterLength ? Number(cfg.minChapterLength) : 0;
  const max = cfg.maxChapterLength ? Number(cfg.maxChapterLength) : 0;
  if (min > 0 && bytes < min) {
    console.log(
      chalk.yellow(
        `  ⚠ content is ${bytes} bytes; novel requires ≥ ${min}. Submission will revert.`,
      ),
    );
  }
  if (max > 0 && bytes > max) {
    console.log(
      chalk.yellow(
        `  ⚠ content is ${bytes} bytes; novel allows ≤ ${max}. Submission will revert.`,
      ),
    );
  }
}
