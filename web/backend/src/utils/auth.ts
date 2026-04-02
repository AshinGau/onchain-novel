import { type Request, type Response, type NextFunction } from "express";
import { verifyMessage } from "viem";

declare module "express-serve-static-core" {
  interface Request {
    verifiedAddress?: string;
  }
}

/**
 * Middleware to verify that the caller owns the claimed address.
 * Expects headers:
 *   x-address: the wallet address
 *   x-signature: EIP-191 signature of the request body JSON string
 *
 * Attaches `req.verifiedAddress` on success.
 */
export async function verifyWallet(req: Request, res: Response, next: NextFunction) {
  const address = req.headers["x-address"] as string | undefined;
  const signature = req.headers["x-signature"] as string | undefined;

  if (!address || !signature) {
    return res.status(401).json({ error: "Missing x-address or x-signature headers" });
  }

  try {
    const message = JSON.stringify(req.body);
    const valid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });

    if (!valid) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    req.verifiedAddress = address.toLowerCase();
    next();
  } catch {
    return res.status(401).json({ error: "Signature verification failed" });
  }
}
