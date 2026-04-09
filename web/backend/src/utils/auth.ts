import { verifyMessage } from "viem";

/**
 * Verify an EIP-191 signature against a canonical message and claimed address.
 * Returns the lowercased address on success, or null on failure.
 */
export async function verifyEip191(
  address: string,
  message: string,
  signature: string,
): Promise<string | null> {
  try {
    const ok = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
    return ok ? address.toLowerCase() : null;
  } catch {
    return null;
  }
}
