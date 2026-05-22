import type { Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

const groqCreate = vi.hoisted(() => vi.fn());

vi.mock("groq-sdk", () => ({
  default: class MockGroq {
    chat = {
      completions: {
        create: groqCreate,
      },
    };
  },
}));

import { streamMovieAgentChat } from "./movieAgentChat.js";

function sseRes(): Response & { chunks: string[] } {
  const chunks: string[] = [];
  const res = {
    statusCode: 0,
    status(n: number) {
      res.statusCode = n;
      return res;
    },
    setHeader: vi.fn(),
    write: (line: string) => {
      chunks.push(line);
    },
    end: vi.fn(),
    flushHeaders: vi.fn(),
    chunks,
  };
  return res as unknown as Response & { chunks: string[] };
}

describe("streamMovieAgentChat", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, "fetch">> | undefined;

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
  });

  it("emits an error chunk when Groq API key missing", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    const res = sseRes();
    await streamMovieAgentChat({
      res,
      digestBlock: "digest",
      messages: [{ role: "user", content: "hi" }],
      config: { providerKey: "groq", modelKey: "llama" },
    });
    expect(res.chunks.some((c) => c.includes("GROQ_API_KEY"))).toBe(true);
  });

  it("streams Groq deltas when configured", async () => {
    vi.stubEnv("GROQ_API_KEY", "secret");
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: "Hello" } }] };
        yield { choices: [{ delta: { content: " world" } }] };
      },
    };
    groqCreate.mockResolvedValueOnce(stream);

    const res = sseRes();
    await streamMovieAgentChat({
      res,
      digestBlock: "digest",
      messages: [{ role: "user", content: "ping" }],
      config: { providerKey: "groq", modelKey: "llama" },
    });

    const payload = res.chunks.join("");
    expect(payload).toContain("Hello");
    expect(payload).toContain(`"type":"done"`);
  });

  it("suppresses Groq deltas that ship empty fragments", async () => {
    vi.stubEnv("GROQ_API_KEY", "secret");
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: "" } }] };
        yield { choices: [{ delta: {} }] };
        yield { choices: [{ delta: { content: "Seen" } }] };
      },
    };
    groqCreate.mockResolvedValueOnce(stream);

    const res = sseRes();
    await streamMovieAgentChat({
      res,
      digestBlock: "digest",
      messages: [{ role: "user", content: "ping" }],
      config: { providerKey: "groq", modelKey: "llama" },
    });

    const joined = res.chunks.join("");
    expect(joined).toContain("Seen");
    expect(joined.match(/"type":"delta"/g)?.length ?? 0).toBe(1);
  });

  it("continues streaming when flushHeaders throws", async () => {
    vi.stubEnv("GROQ_API_KEY", "secret");
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: "ok" } }] };
      },
    };
    groqCreate.mockResolvedValueOnce(stream);

    const chunks: string[] = [];
    const flushHeaders = vi.fn().mockImplementation(() => {
      throw new Error("flush exploded");
    });
    const res = {
      statusCode: 0,
      status(n: number) {
        res.statusCode = n;
        return res;
      },
      setHeader: vi.fn(),
      write: (line: string) => {
        chunks.push(line);
      },
      end: vi.fn(),
      flushHeaders,
      chunks,
    } as unknown as Response & { chunks: string[] };

    await streamMovieAgentChat({
      res,
      digestBlock: "digest",
      messages: [{ role: "user", content: "ping" }],
      config: { providerKey: "groq", modelKey: "llama" },
    });

    expect(chunks.join("")).toContain("ok");
  });

  it("surfaces Groq transport failures", async () => {
    vi.stubEnv("GROQ_API_KEY", "secret");
    groqCreate.mockRejectedValueOnce(new Error("rate limited"));
    const res = sseRes();
    await streamMovieAgentChat({
      res,
      digestBlock: "digest",
      messages: [{ role: "user", content: "ping" }],
      config: { providerKey: "groq", modelKey: "llama" },
    });
    expect(res.chunks.join("")).toContain("rate limited");
  });

  it("emits an error chunk when OpenAI API key missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const res = sseRes();
    await streamMovieAgentChat({
      res,
      digestBlock: "digest",
      messages: [{ role: "user", content: "hi" }],
      config: { providerKey: "openai", modelKey: "gpt-mini" },
    });
    expect(res.chunks.some((c) => c.includes("OPENAI_API_KEY"))).toBe(true);
  });

  it("handles OpenAI streaming chunks", async () => {
    vi.stubEnv("OPENAI_API_KEY", "oa");
    const encoder = new TextEncoder();
    const sse =
      `data: ${JSON.stringify({
        choices: [{ delta: { content: "Streamed" } }],
      })}\n\n` + `data: [DONE]\n\n`;

    let sent = false;
    const reader = {
      read: async () => {
        if (sent) return { done: true, value: undefined };
        sent = true;
        return { done: false as const, value: encoder.encode(sse) };
      },
    };

    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as Response);

    const res = sseRes();
    await streamMovieAgentChat({
      res,
      digestBlock: "digest",
      messages: [{ role: "user", content: "ping" }],
      config: { providerKey: "openai", modelKey: "gpt-mini" },
    });
    expect(res.chunks.join("")).toContain("Streamed");
  });

  it("surfaces failing OpenAI HTTP responses", async () => {
    vi.stubEnv("OPENAI_API_KEY", "oa");

    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "boom",
    } as Response);

    const res = sseRes();
    await streamMovieAgentChat({
      res,
      digestBlock: "digest",
      messages: [{ role: "user", content: "ping" }],
      config: { providerKey: "openai", modelKey: "gpt-mini" },
    });
    expect(res.chunks.join("")).toContain("OpenAI error 500");
  });

  it("handles missing bodies on OpenAI streams", async () => {
    vi.stubEnv("OPENAI_API_KEY", "oa");

    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      body: null,
    } as Response);

    const res = sseRes();
    await streamMovieAgentChat({
      res,
      digestBlock: "digest",
      messages: [{ role: "user", content: "ping" }],
      config: { providerKey: "openai", modelKey: "gpt-mini" },
    });
    expect(res.chunks.join("")).toContain("OpenAI stream unavailable");
  });

  it("ignores partial SSE JSON payloads", async () => {
    vi.stubEnv("OPENAI_API_KEY", "oa");
    const encoder = new TextEncoder();
    const sse =
      `data: not-json-{garbage]\n\n` +
      `data: ${JSON.stringify({
        choices: [{ delta: { content: "Recovered" } }],
      })}\n\n` +
      `data: [DONE]\n\n`;

    let calls = 0;
    const reader = {
      read: async () => {
        calls += 1;
        if (calls > 1) return { done: true as const, value: undefined };
        return { done: false as const, value: encoder.encode(sse) };
      },
    };

    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as Response);

    const res = sseRes();
    await streamMovieAgentChat({
      res,
      digestBlock: "digest",
      messages: [{ role: "user", content: "ping" }],
      config: { providerKey: "openai", modelKey: "gpt-mini" },
    });

    expect(res.chunks.join("")).toContain("Recovered");
  });

  it("reports OpenAI stream setup failures", async () => {
    vi.stubEnv("OPENAI_API_KEY", "oa");
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network down"));

    const res = sseRes();
    await streamMovieAgentChat({
      res,
      digestBlock: "digest",
      messages: [{ role: "user", content: "ping" }],
      config: { providerKey: "openai", modelKey: "gpt-mini" },
    });

    expect(res.chunks.join("")).toContain("network down");
  });

  it("explains offline mode for unsupported providers", async () => {
    const res = sseRes();
    await streamMovieAgentChat({
      res,
      digestBlock: "digest",
      messages: [{ role: "user", content: "ping" }],
      config: { providerKey: "anthropic", modelKey: "claude" },
    });
    expect(res.chunks.join("")).toContain("demo needs an active LLM");
  });
});
