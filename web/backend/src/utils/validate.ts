import type { Request, Response, NextFunction } from "express";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/** Express middleware: validates :address param is a valid hex address */
export function validateAddress(req: Request, res: Response, next: NextFunction) {
  const addr = req.params.address;
  if (!addr || !ADDR_RE.test(addr)) {
    return res.status(400).json({ error: "Invalid address format" });
  }
  next();
}

/** Parse an integer query param with safe defaults and bounds */
export function safeInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = parseInt(value as string, 10);
  if (isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Content location enum matching contract DataTypes.ContentLocation */
export enum ContentLocation {
  Onchain = 0,
  External = 1,
  HTTP = 2,
}
