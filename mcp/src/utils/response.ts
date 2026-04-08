/** Standard MCP tool response helpers. */

export function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function fail(msg: string) {
  return { content: [{ type: "text" as const, text: msg }], isError: true as const };
}
