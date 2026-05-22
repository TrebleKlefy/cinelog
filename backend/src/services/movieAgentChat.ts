import type { Response } from "express";
import Groq from "groq-sdk";
import type { ActiveLlmConfig } from "./llm.js";

export type AgentChatTurn = { role: "user" | "assistant"; content: string };

const AGENT_SYSTEM_PREAMBLE = `You are cineLog's in-app movie concierge. You speak in a friendly, conversational tone.

You receive a LIVE TMDB digest block refreshed on every request — use it as the factual source for what's trending TODAY, critically top-rated catalogue picks, and films currently billed as playing in theaters (US-ish lists via TMDB).

Capabilities you should lean into:
- Compare titles, eras, moods, and "what should I watch tonight?" decisions.
- When you recommend something from the digest, cite its TMDB id in parentheses exactly like "(TMDB 12345)" so the UI can deeplink previews.
- You may mention other famous titles if the digests are sparse or if the user's question reaches beyond them — still be honest when you're going from general film knowledge versus the digest.

Formatting:
- Use short Markdown: **bold** film titles when helpful; bullet lists for several picks at once.
- Keep answers tight (roughly ≤ 320 words) unless the user asks for depth.
- Never invent numerical TMDB ratings; only quote vote averages supplied in the digest when present.

If TMDB shelves are empty in the digest, apologize briefly and still try to answer from general cinematic knowledge — no fake "live trends."`;

function writeSseLine(res: Response, payload: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * Streams assistant tokens via simple JSON-lines SSE: {type:"delta", text}, then {type:"done"} / {type:"error"}.
 */
export async function streamMovieAgentChat(params: {
  res: Response;
  digestBlock: string;
  messages: AgentChatTurn[];
  config: ActiveLlmConfig;
}): Promise<void> {
  const { res, digestBlock, messages, config } = params;

  const systemPrompt = `${AGENT_SYSTEM_PREAMBLE}\n\n--- LIVE TMDB DIGEST ---\n${digestBlock}`;

  const outbound = [{ role: "system" as const, content: systemPrompt }, ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))];

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  /** Express classic */
  try {
    (res as Response & { flushHeaders?: () => void }).flushHeaders?.();
  } catch {
    /* ignore */
  }

  const finalizeError = (message: string) => {
    writeSseLine(res, { type: "error", message });
    writeSseLine(res, { type: "done" });
    res.end();
  };

  if (config.providerKey === "groq") {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey?.trim()) {
      finalizeError("GROQ_API_KEY is not configured on the API server.");
      return;
    }
    try {
      const groq = new Groq({ apiKey });
      const stream = await groq.chat.completions.create({
        model: config.modelKey,
        messages: outbound,
        temperature: 0.7,
        max_completion_tokens: 1200,
        top_p: 1,
        stream: true,
      });
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content ?? "";
        if (text) writeSseLine(res, { type: "delta", text });
      }
      writeSseLine(res, { type: "done" });
      res.end();
    } catch (e) {
      finalizeError((e as Error).message);
    }
    return;
  }

  if (config.providerKey === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey?.trim()) {
      finalizeError("OPENAI_API_KEY is not configured on the API server.");
      return;
    }
    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.modelKey,
          messages: outbound,
          stream: true,
          temperature: 0.7,
          max_tokens: 1200,
        }),
      });
      if (!r.ok) {
        finalizeError(`OpenAI error ${r.status}: ${(await r.text()).slice(0, 400)}`);
        return;
      }
      const reader = r.body?.getReader();
      if (!reader) {
        finalizeError("OpenAI stream unavailable.");
        return;
      }
      const dec = new TextDecoder();
      let carry = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        carry += dec.decode(value, { stream: true });
        const lines = carry.split("\n");
        carry = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
            const piece = json.choices?.[0]?.delta?.content;
            if (piece) writeSseLine(res, { type: "delta", text: piece });
          } catch {
            /* ignore partial JSON */
          }
        }
      }
      writeSseLine(res, { type: "done" });
      res.end();
    } catch (e) {
      finalizeError((e as Error).message);
    }
    return;
  }

  /** Offline / unsupported provider */
  writeSseLine(res, {
    type: "delta",
    text: "This demo needs an active LLM (Groq or OpenAI) selected in **Admin → AI models** with a valid API key. Ask an admin to enable Groq + Llama for streaming chat.",
  });
  writeSseLine(res, { type: "done" });
  res.end();
}
