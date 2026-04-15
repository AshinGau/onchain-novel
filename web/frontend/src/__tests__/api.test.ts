import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchComments, postComment, submitVotePlaintext } from "@/lib/api";

const ok = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("fetchComments", () => {
  it("hits GET /api/chapters/:id/comments and returns the comments array", async () => {
    const fakeComments = [
      { id: 1, chapter_id: "2", author: "0x1", content: "hello", created_at: "2026-04-09" },
    ];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ok(200, { comments: fakeComments }));
    const result = await fetchComments("2");
    expect(result.comments).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/\/chapters\/2\/comments\?page=1&limit=20$/);
  });
});

describe("postComment", () => {
  it("returns ok=true with the created comment on 201", async () => {
    const created = { id: 99, chapter_id: "2", author: "0xabc", content: "hi", created_at: "now" };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(ok(201, created));
    const result = await postComment("2", {
      address: "0xabc",
      content: "hi",
      timestamp: 1700000000,
      signature: "0xdeadbeef",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.comment.id).toBe(99);
    }
  });

  it("returns ok=false with status on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("invalid signature", { status: 401 }),
    );
    const result = await postComment("2", {
      address: "0xabc",
      content: "hi",
      timestamp: 1700000000,
      signature: "0xbad",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
    }
  });

  it("posts the canonical body shape", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        ok(201, { id: 1, chapter_id: "2", author: "0xabc", content: "hi", created_at: "now" }),
      );
    await postComment("2", {
      address: "0xabc",
      content: "hi",
      timestamp: 1700,
      signature: "0xsig",
    });
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      address: "0xabc",
      content: "hi",
      timestamp: 1700,
      signature: "0xsig",
    });
  });
});

describe("submitVotePlaintext", () => {
  it("returns ok=true on 201", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(ok(201, { ok: true }));
    const result = await submitVotePlaintext({
      address: "0xabc",
      novelId: 1,
      round: 1,
      candidateId: 2,
      salt: ("0x" + "1".repeat(64)) as `0x${string}`,
      timestamp: 1700,
      signature: "0xsig",
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(201);
  });

  it("returns ok=false on 503 (keeper-assisted reveal disabled)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("disabled", { status: 503 }));
    const result = await submitVotePlaintext({
      address: "0xabc",
      novelId: 1,
      round: 1,
      candidateId: 2,
      salt: ("0x" + "1".repeat(64)) as `0x${string}`,
      timestamp: 1700,
      signature: "0xsig",
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
  });
});
