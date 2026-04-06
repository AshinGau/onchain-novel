import { z, type ZodTypeAny } from "zod";

/**
 * Wrap a `z.array(…)` schema with a preprocess step that recovers from
 * double-stringified JSON — a known issue where some MCP clients (e.g.
 * Claude Code) serialise array parameters as JSON strings instead of
 * native arrays.
 *
 * Usage:
 *   jsonArray(z.array(z.string()))
 *   jsonArray(z.array(z.object({ ... })).optional())
 */
export function jsonArray<T extends ZodTypeAny>(schema: T) {
  return z.preprocess((val) => {
    if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // not valid JSON — fall through to normal validation
      }
    }
    return val;
  }, schema);
}
