import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config.js";

export function registerWalletTools(server: McpServer) {
  server.tool(
    "switch_wallet",
    "Switch the active wallet by providing a new private key. Returns the new wallet address.",
    {
      privateKey: z.string().describe("Hex-encoded private key (0x-prefixed)"),
    },
    async ({ privateKey }) => {
      try {
        const key = privateKey as Hex;
        const account = privateKeyToAccount(key);
        (config as { privateKey: Hex }).privateKey = key;
        return {
          content: [
            {
              type: "text" as const,
              text: `Wallet switched to: ${account.address}`,
            },
          ],
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_wallet_address",
    "Get the current active wallet address.",
    {},
    async () => {
      try {
        const account = privateKeyToAccount(config.privateKey);
        return {
          content: [
            {
              type: "text" as const,
              text: `Current wallet: ${account.address}`,
            },
          ],
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}
