import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL, api } from "../lib/api";
import type { AuthState } from "../types/auth";
import { MovieDetailModal } from "./MovieDetailModal";
import { MoviePoster } from "./MoviePoster";

type ShelfMovie = {
  tmdbId: number;
  title: string;
  releaseYear: number | null;
  posterUrl: string | null;
  voteAverage: number | null;
};

type BootstrapResponse = {
  trendingToday: ShelfMovie[];
  topRated: ShelfMovie[];
  nowPlaying: ShelfMovie[];
};

type ChatTurn = { role: "user" | "assistant"; content: string };

type AgentSseEvent =
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

const SESSION_AGENT_OPENED_KEY = "cinelog_movie_agent_chat_opened";

/** Rotating nudges to draw attention to the concierge FAB until the user opens it once */
const FAB_ATTENTION_MESSAGES: string[] = [
  "Not sure what to watch? Tap the bubble — trending & top‑rated picks, plus AI chat.",
  "Your movie concierge has today’s buzz, critic darlings, and what’s in theaters.",
  "Stuck scrolling? Ask the assistant for tonight’s lineup in one tap.",
  "Trending trailers, cozy nights, theater runs — chat with your film guide here 💬",
  "Quick vibe check: tap 💬 for personalized “what should I watch?” ideas.",
];

const STARTER_MESSAGES: ChatTurn[] = [
  {
    role: "assistant",
    content:
      "Hi — I'm your cineLog movie concierge. Use the rails below for **trending today**, **critically acclaimed** picks, and **in theaters**. Ask follow-ups anytime (mention a title or TMDB id if you can).",
  },
];

function sessionAgentChatOpened(): boolean {
  try {
    return typeof sessionStorage !== "undefined" && sessionStorage.getItem(SESSION_AGENT_OPENED_KEY) === "1";
  } catch {
    return false;
  }
}

async function consumeAgentChatSse(stream: ReadableStream<Uint8Array>, onEvt: (e: AgentSseEvent) => void) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });

      while (true) {
        const gap = buf.indexOf("\n\n");
        if (gap < 0) break;
        const block = buf.slice(0, gap).trimEnd();
        buf = buf.slice(gap + 2);
        for (const rawLine of block.split("\n")) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          try {
            const evt = JSON.parse(payload) as AgentSseEvent;
            onEvt(evt);
          } catch {
            /* ignore malformed frame */
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function ShelfStrip({
  label,
  subtitle,
  items,
  onPick,
}: {
  label: string;
  subtitle: string;
  items: ShelfMovie[];
  onPick: (id: number) => void;
}) {
  return (
    <section className="movie-agent__shelf" aria-label={label}>
      <div className="movie-agent__shelf-head">
        <h3>{label}</h3>
        <p>{subtitle}</p>
      </div>
      {items.length === 0 ? (
        <p className="movie-agent__shelf-empty">No picks from TMDB right now.</p>
      ) : (
        <div className="movie-agent__shelf-row">
          {items.map((m) => (
            <button
              key={m.tmdbId}
              type="button"
              className="movie-agent__poster-hit"
              onClick={() => onPick(m.tmdbId)}
              title={`${m.title}${m.releaseYear ? ` (${m.releaseYear})` : ""}${m.voteAverage != null ? ` · ★ ${m.voteAverage.toFixed(1)}` : ""}`}
            >
              <MoviePoster src={m.posterUrl} alt={`${m.title} poster`} className="movie-agent__poster" />
              <span className="movie-agent__poster-cap">{m.title}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function MovieAgentChatWidget({ auth }: { auth: NonNullable<AuthState> }) {
  const token = auth.token;
  const [panelOpen, setPanelOpen] = useState(false);
  const [fabHintsMuted, setFabHintsMuted] = useState(() => sessionAgentChatOpened());
  const [fabHintVisible, setFabHintVisible] = useState(false);
  const [fabHintText, setFabHintText] = useState(() => FAB_ATTENTION_MESSAGES[0] ?? "");
  const [messages, setMessages] = useState<ChatTurn[]>(STARTER_MESSAGES);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapLoading, setBootstrapLoading] = useState(false);
  const [tmdbPreviewId, setTmdbPreviewId] = useState<number | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToLatest = () => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  };

  useEffect(() => {
    scrollToLatest();
  }, [messages, streaming]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const openPanelAndMuteHints = useCallback(() => {
    try {
      sessionStorage.setItem(SESSION_AGENT_OPENED_KEY, "1");
    } catch {
      /* ignore storage */
    }
    setFabHintsMuted(true);
    setFabHintVisible(false);
    setPanelOpen(true);
  }, []);

  /** Periodic teaser copy until user opens concierge once this session */
  useEffect(() => {
    if (panelOpen || fabHintsMuted) {
      setFabHintVisible(false);
      return;
    }

    let cancelled = false;
    const allTimers: ReturnType<typeof setTimeout>[] = [];

    const schedule = (delay: number, fn: () => void) => {
      const id = window.setTimeout(() => {
        if (!cancelled) fn();
      }, delay);
      allTimers.push(id);
      return id;
    };

    const pickMessage = () => {
      const list = FAB_ATTENTION_MESSAGES;
      if (!list.length) return "";
      return list[Math.floor(Math.random() * list.length)] ?? list[0] ?? "";
    };

    function showAttentionCycle(): void {
      if (cancelled) return;
      setFabHintText(pickMessage());
      setFabHintVisible(true);
      schedule(6500 + Math.random() * 2500, () => {
        setFabHintVisible(false);
        if (cancelled) return;
        schedule(18500 + Math.random() * 22000, showAttentionCycle);
      });
    }

    schedule(4500 + Math.random() * 5500, showAttentionCycle);

    return () => {
      cancelled = true;
      for (const t of allTimers) window.clearTimeout(t);
    };
  }, [panelOpen, fabHintsMuted]);

  const loadBootstrap = useCallback(async () => {
    setBootstrapLoading(true);
    setBootstrapError(null);
    try {
      const data = await api<BootstrapResponse>("/api/ai/agent/bootstrap", undefined, token);
      setBootstrap(data);
    } catch (e) {
      setBootstrap(null);
      setBootstrapError(e instanceof Error ? e.message : "Could not load movie picks.");
    } finally {
      setBootstrapLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (panelOpen) void loadBootstrap();
  }, [panelOpen, loadBootstrap]);

  const sendMessages = async (nextMessages: ChatTurn[]) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setStreaming(true);

    let sawDone = false;
    let errText = "";

    try {
      const res = await fetch(`${API_URL}/api/ai/agent/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messages: nextMessages }),
        signal: ac.signal,
      });

      if (!res.ok) {
        const data: unknown = await res.json().catch(() => ({}));
        const msg =
          typeof data === "object" && data !== null && "error" in data
            ? String((data as { error: unknown }).error)
            : `Request failed (${res.status})`;
        throw new Error(msg);
      }
      if (!res.body) throw new Error("No response stream.");

      await consumeAgentChatSse(res.body, (evt) => {
        if (evt.type === "delta" && evt.text) {
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy.at(-1);
            if (!last || last.role !== "assistant") return prev;
            copy[copy.length - 1] = { role: "assistant", content: last.content + evt.text };
            return copy;
          });
          return;
        }
        if (evt.type === "error") errText = evt.message;
        if (evt.type === "done") sawDone = true;
      });

      if (errText) {
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy.at(-1);
          if (!last || last.role !== "assistant") return prev;
          copy[copy.length - 1] = {
            role: "assistant",
            content:
              last.content.trim().length === 0
                ? `Sorry — something went wrong: ${errText}`
                : `${last.content}\n\n⚠️ ${errText}`,
          };
          return copy;
        });
      } else if (!sawDone) {
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy.at(-1);
          if (!last || last.role !== "assistant") return prev;
          if (last.content.trim().length === 0) {
            copy[copy.length - 1] = { role: "assistant", content: "Response ended unexpectedly — try asking again." };
          }
          return copy;
        });
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const msg = e instanceof Error ? e.message : "Chat failed.";
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy.at(-1);
        if (!last || last.role !== "assistant") return prev;
        copy[copy.length - 1] =
          last.content.trim().length === 0
            ? { role: "assistant", content: msg }
            : { role: "assistant", content: `${last.content}\n\n⚠️ ${msg}` };
        return copy;
      });
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const onSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || streaming) return;

    const userMsg: ChatTurn = { role: "user", content: text };
    const transcript = [...messages, userMsg, { role: "assistant", content: "" } as ChatTurn];
    setMessages(transcript);
    setDraft("");
    await sendMessages([...messages, userMsg]);
  };

  const onChip = async (preset: string) => {
    if (streaming) return;
    const userMsg: ChatTurn = { role: "user", content: preset };
    const next = [...messages, userMsg, { role: "assistant", content: "" } as ChatTurn];
    setMessages(next);
    await sendMessages([...messages, userMsg]);
  };

  return (
    <>
      {!panelOpen ? (
        <div className="movie-agent__fab-stack">
          {fabHintVisible ? (
            <div className="movie-agent__hint-card" role="status" aria-live="polite" aria-atomic="true">
              <button
                type="button"
                className="movie-agent__hint-dismiss"
                aria-label="Hide this suggestion"
                onClick={() => setFabHintVisible(false)}
              >
                ✕
              </button>
              <p className="movie-agent__hint-text">{fabHintText}</p>
            </div>
          ) : null}
          <button
            type="button"
            className={`movie-agent__fab${fabHintVisible ? " movie-agent__fab--nudge" : ""}`}
            onClick={openPanelAndMuteHints}
            aria-label="Open movie concierge chat — tap for trending picks and AI help"
            title="Movie concierge"
          >
            <span className="movie-agent__fab-inner" aria-hidden>
              💬
            </span>
          </button>
        </div>
      ) : null}

      {panelOpen ? (
        <button type="button" className="movie-agent__backdrop" aria-label="Close concierge" tabIndex={-1} onClick={() => setPanelOpen(false)} />
      ) : null}

      <aside className={`movie-agent__panel${panelOpen ? " movie-agent__panel--open" : ""}`} aria-hidden={!panelOpen}>
        <header className="movie-agent__head">
          <div>
            <h2 id="movie-agent-title">Movie concierge</h2>
            <p className="movie-agent__sub">
              Trends, acclaim, now playing — ask for picks or comparisons. Tap posters for details.
            </p>
          </div>
          <button type="button" className="button button--secondary button--sm movie-agent__close" onClick={() => setPanelOpen(false)} aria-label="Close concierge">
            ✕
          </button>
        </header>

        <div className="movie-agent__rails">
          {bootstrapLoading ? <p className="movie-agent__rails-hint">Loading live TMDB shelves…</p> : null}
          {bootstrapError ? <p className="movie-agent__rails-error">{bootstrapError}</p> : null}
          {bootstrap ? (
            <>
              <ShelfStrip
                label="Buzzing today"
                subtitle="TMDB trending · day"
                items={bootstrap.trendingToday}
                onPick={setTmdbPreviewId}
              />
              <ShelfStrip label="Highly rated" subtitle="TMDB top rated catalogue" items={bootstrap.topRated} onPick={setTmdbPreviewId} />
              <ShelfStrip label="In theaters now" subtitle="TMDB now playing · US-facing" items={bootstrap.nowPlaying} onPick={setTmdbPreviewId} />
              <button type="button" className="movie-agent__refresh" disabled={streaming || bootstrapLoading} onClick={() => void loadBootstrap()}>
                Refresh shelves
              </button>
            </>
          ) : null}
        </div>

        <div className="movie-agent__talk" aria-labelledby="movie-agent-title">
          <div className="movie-agent__chips" aria-label="Quick prompts">
            {streaming ? null : (
              <>
                <button type="button" className="movie-agent__chip" onClick={() => void onChip("What’s buzzing today and why should I care?")}>
                  What&apos;s buzzing?
                </button>
                <button type="button" className="movie-agent__chip" onClick={() => void onChip("Pick one critically acclaimed film from top rated — something I might have missed.")}>
                  Top‑rated wildcard
                </button>
                <button type="button" className="movie-agent__chip" onClick={() => void onChip("Among what’s playing in theaters now, what’s the best theater night choice?")}>
                  Tonight in theaters
                </button>
              </>
            )}
          </div>

          <div className="movie-agent__msgs" ref={listRef}>
            {messages.map((m, i) => (
              <div key={`${m.role}-${i}`} className={`movie-agent__bubble movie-agent__bubble--${m.role}`}>
                {m.role === "assistant" ? (
                  <>
                    {/* lightweight markdown-ish line breaks */}
                    <div className="movie-agent__md">
                      {m.content.split("\n").map((line, li) => (
                        <p key={li}>{line || "\u00a0"}</p>
                      ))}
                    </div>
                  </>
                ) : (
                  <p>{m.content}</p>
                )}
              </div>
            ))}
            {streaming ? <div className="movie-agent__typing"><span>.</span><span>.</span><span>.</span></div> : null}
          </div>

          <form className="movie-agent__composer" onSubmit={(ev) => void onSubmit(ev)}>
            <label className="visually-hidden" htmlFor="movie-agent-input">
              Message to concierge
            </label>
            <textarea
              id="movie-agent-input"
              rows={2}
              className="input movie-agent__textarea"
              placeholder={
                streaming ? "Assistant is replying…" : "Ask about the rails below, or describe your mood..."
              }
              maxLength={4000}
              value={draft}
              disabled={streaming}
              onChange={(ev) => setDraft(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" && !ev.shiftKey) {
                  ev.preventDefault();
                  void onSubmit();
                }
              }}
            />
            <div className="movie-agent__composer-actions">
              <button type="submit" className="button movie-agent__send" disabled={streaming || draft.trim().length === 0}>
                Send
              </button>
            </div>
          </form>
        </div>
      </aside>

      <MovieDetailModal auth={auth} open={tmdbPreviewId != null} onClose={() => setTmdbPreviewId(null)} catalogMovieId={null} tmdbPreviewId={tmdbPreviewId} />
    </>
  );
}
