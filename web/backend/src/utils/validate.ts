import type { NextFunction, Request, Response } from "express";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const ID_RE = /^\d+$/;
// u64::MAX as decimal. Chapter/novel IDs are uint64.
const MAX_ID = 18446744073709551615n;

/** Returns true if `s` is a 0x-prefixed 40-char hex address. */
export function isAddress(s: unknown): s is string {
  return typeof s === "string" && ADDR_RE.test(s);
}

/** Returns true if `s` is a non-empty all-digit string fitting in uint64. */
export function isId(s: unknown): s is string {
  if (typeof s !== "string" || !ID_RE.test(s)) return false;
  try {
    return BigInt(s) <= MAX_ID;
  } catch {
    return false;
  }
}

/** Express middleware: validates :address param is a valid hex address */
export function validateAddress(req: Request, res: Response, next: NextFunction) {
  if (!isAddress(req.params.address)) {
    return res.status(400).json({ error: "Invalid address format" });
  }
  next();
}

/** Express middleware factory: validates one or more BIGINT-like route params. Default param name is `id`. */
export function validateIdParams(...names: string[]) {
  const keys = names.length > 0 ? names : ["id"];
  return (req: Request, res: Response, next: NextFunction) => {
    for (const k of keys) {
      if (!isId(req.params[k])) {
        return res.status(400).json({ error: `Invalid ${k}: must be a positive integer id` });
      }
    }
    next();
  };
}

/** Parse an integer query param with safe defaults and bounds */
export function safeInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = parseInt(value as string, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Parse a strictly positive integer from an untrusted input.
 * Accepts only digit strings / integer numbers. Returns null on anything else.
 * Rejects: NaN, Infinity, 0, negatives, floats, scientific notation, non-digit prefix.
 */
export function parsePositiveInt(v: unknown): number | null {
  if (typeof v === "number") {
    return Number.isInteger(v) && v > 0 && Number.isFinite(v) ? v : null;
  }
  if (typeof v !== "string") return null;
  if (!/^\d+$/.test(v)) return null;
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Parse and clamp the standard ?page / ?limit query params. Centralizes the bounds so all
 * list endpoints share the same semantics (page ≥ 1 up to 1000; limit within caller-chosen
 * default/max). Returns an SQL-ready `offset` alongside the clamped values.
 */
export function parsePagination(
  query: { page?: unknown; limit?: unknown },
  opts: { defaultLimit?: number; maxLimit?: number } = {},
): { page: number; limit: number; offset: number } {
  const defaultLimit = opts.defaultLimit ?? 20;
  const maxLimit = opts.maxLimit ?? 100;
  const page = safeInt(query.page, 1, 1, 1000);
  const limit = safeInt(query.limit, defaultLimit, 1, maxLimit);
  return { page, limit, offset: (page - 1) * limit };
}

/** Content location enum matching contract DataTypes.ContentLocation */
export enum ContentLocation {
  Onchain = 0,
  External = 1,
  HTTP = 2,
}
