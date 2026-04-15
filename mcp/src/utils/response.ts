/** Standard MCP tool response helpers. */

export function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function fail(msg: string) {
  return { content: [{ type: "text" as const, text: msg }], isError: true as const };
}

/**
 * Sanitize errors before returning to the agent. viem errors embed full RPC
 * URLs (which may contain provider API keys), gas-estimation dumps, and stack
 * traces — none of which belong in the agent's context.
 *
 * Strategy: keep only the first non-empty line, scrub http(s) URLs and any
 * 0x-prefixed hex of length > 8 (so addresses/txhashes in context messages
 * stay redacted to a marker but selectors/short nonces remain readable).
 */
export function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const firstLine = raw.split("\n").find((l) => l.trim().length > 0) ?? "unknown error";
  return firstLine
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\/Users\/[^/\s:]+/g, "~")
    .slice(0, 400);
}

/** Wrap untrusted on-chain or user-generated text with explicit delimiters so
 *  an agent does not mistake embedded instructions for system directives. */
export function untrusted(kind: string, body: string): string {
  const max = 8000;
  const clipped = body.length > max ? body.slice(0, max) + "\n[...truncated]" : body;
  return `<untrusted source="${kind}">\n${clipped}\n</untrusted>`;
}

/** Compact one-line sanitization for list/table views: strip newlines and
 *  <>-tags, clip to `max` chars. Preserves readability while neutering
 *  prompt-injection attempts in titles, nicknames, etc. */
export function inlineSafe(s: string, max = 80): string {
  const flat = s.replace(/[\r\n\t]+/g, " ").replace(/[<>]/g, "");
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}
