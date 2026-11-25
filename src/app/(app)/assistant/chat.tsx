"use client";

import { ArrowUp, Check, LoaderCircle, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";

type Step = { id: string; name: string; state: "running" | "ok" | "error" };
type Turn = { role: "user" | "assistant"; content: string; steps?: Step[]; error?: string };

/** What the agent is doing, in the user's language. */
const toolLabel: Record<string, string> = {
  search_contacts: "מחפש אנשי קשר",
  get_contact: "קורא כרטיס לקוח",
  list_tickets: "עובר על הפניות",
  get_ticket: "קורא את הפנייה",
  list_deals: "עובר על העסקאות",
  pipeline_summary: "מחשב את מצב הצנרת",
  check_availability: "בודק את היומן",
  add_contact_note: "מוסיף הערה לכרטיס",
  create_ticket: "פותח פנייה",
  update_ticket: "מעדכן פנייה",
  handoff_to_human: "מעביר לנציג",
  book_appointment: "קובע תור",
};

export function AssistantChat({ suggestions }: { suggestions: string[] }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const history: Turn[] = [...turns.filter((t) => t.content), { role: "user", content }];
    setTurns([...history, { role: "assistant", content: "", steps: [] }]);
    setInput("");
    setBusy(true);

    const patch = (f: (t: Turn) => Turn) => setTurns((all) => [...all.slice(0, -1), f(all.at(-1)!)]);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        patch((t) => ({ ...t, error: j.error ?? "משהו השתבש" }));
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      // Text arrives per model turn; only the last turn's text is the answer.
      let fresh = true;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const line of lines) {
          if (!line) continue;
          const e = JSON.parse(line);
          if (e.type === "text") {
            patch((t) => ({ ...t, content: (fresh ? "" : t.content) + e.text }));
            fresh = false;
          } else if (e.type === "tool_start") {
            fresh = true;
            patch((t) => ({ ...t, steps: [...(t.steps ?? []), { id: e.id, name: e.name, state: "running" }] }));
          } else if (e.type === "tool_end") {
            patch((t) => ({
              ...t,
              steps: t.steps?.map((s) => (s.id === e.id ? { ...s, state: e.ok ? "ok" : "error" } : s)),
            }));
          } else if (e.type === "error") {
            patch((t) => ({ ...t, error: e.error }));
          }
        }
      }
    } catch {
      patch((t) => ({ ...t, error: "החיבור נקטע. נסו שוב." }));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex min-h-[calc(100dvh-14rem)] flex-col rounded-xl bg-surface shadow-card">
      <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6" aria-live="polite">
        {turns.length === 0 ? (
          <div className="mx-auto grid max-w-xl place-items-center gap-5 py-10 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
              <Sparkles size={22} strokeWidth={1.6} aria-hidden />
            </span>
            <div>
              <p className="font-medium text-ink">במה אפשר לעזור?</p>
              <p className="mt-1 text-sm text-muted">העוזר מחפש במערכת, מסכם ומבצע פעולות בשמכם.</p>
            </div>
            <ul className="flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-full border border-line px-3.5 py-1.5 text-sm text-ink-2 transition-colors hover:border-accent/50 hover:bg-accent-soft hover:text-ink"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ol className="mx-auto grid max-w-3xl gap-5">
            {turns.map((t, i) => (
              <li key={i} className={cx("grid gap-2", t.role === "user" && "justify-items-start")}>
                {t.role === "user" ? (
                  <p className="max-w-[85%] rounded-2xl rounded-ss-sm bg-accent px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-accent-ink">
                    {t.content}
                  </p>
                ) : (
                  <div className="grid gap-2">
                    {!!t.steps?.length && (
                      <ul className="flex flex-wrap gap-1.5">
                        {t.steps.map((s) => (
                          <li
                            key={s.id}
                            className={cx(
                              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs",
                              s.state === "error" ? "bg-danger-soft text-danger" : "bg-surface-2 text-muted",
                            )}
                          >
                            {s.state === "running" ? (
                              <LoaderCircle size={12} className="animate-spin" aria-hidden />
                            ) : s.state === "ok" ? (
                              <Check size={12} aria-hidden />
                            ) : (
                              <X size={12} aria-hidden />
                            )}
                            {toolLabel[s.name] ?? s.name}
                          </li>
                        ))}
                      </ul>
                    )}
                    {t.content ? (
                      <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink">{t.content}</p>
                    ) : (
                      !t.error &&
                      busy &&
                      i === turns.length - 1 && (
                        <p className="flex items-center gap-2 text-sm text-muted">
                          <LoaderCircle size={14} className="animate-spin" aria-hidden />
                          חושב…
                        </p>
                      )
                    )}
                    {t.error && (
                      <p role="alert" className="text-sm text-danger">
                        {t.error}
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="border-t border-line p-3 sm:p-4"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-line bg-surface px-3 py-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
          <label htmlFor="assistant-input" className="sr-only">
            הודעה לעוזר
          </label>
          <textarea
            id="assistant-input"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            maxLength={4000}
            placeholder="למשל: קבע לאבי גולן הדגמה ביום ראשון ב-10:00"
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-sm outline-none [field-sizing:content] placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            aria-label="שליחה"
            className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-ink transition-opacity disabled:opacity-40"
          >
            {busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : <ArrowUp size={18} aria-hidden />}
          </button>
        </div>
      </form>
    </div>
  );
}
