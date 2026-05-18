"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";

interface LouiWidgetProps {
  openLabel: string;
  closeLabel: string;
  headerEyebrow: string;
  headerTitle: string;
  headerSubtitle: string;
  placeholder: string;
  sendLabel: string;
  emptyTitle: string;
  emptyBody: string;
  suggestions: string[];
  toolNotice: string;
  disclaimer: string;
}

function messageText(m: UIMessage): string {
  return (m.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function hasActiveToolCall(m: UIMessage): boolean {
  return (m.parts ?? []).some(
    (p) => typeof p.type === "string" && p.type.startsWith("tool-"),
  );
}

export function LouiWidget({
  openLabel,
  closeLabel,
  headerEyebrow,
  headerTitle,
  headerSubtitle,
  placeholder,
  sendLabel,
  emptyTitle,
  emptyBody,
  suggestions,
  toolNotice,
  disclaimer,
}: LouiWidgetProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/loui" }),
  });

  const isStreaming = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open, isStreaming]);

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    setInput("");
    void sendMessage({ text: trimmed });
  }

  return (
    <>
      {/* Floating button */}
      <button
        type="button"
        aria-label={open ? closeLabel : openLabel}
        onClick={() => setOpen((v) => !v)}
        className="fixed z-50 bottom-6 right-6 lg:bottom-8 lg:right-8 w-14 h-14 rounded-full bg-ink text-ivory shadow-xl flex items-center justify-center hover:bg-ink/90 transition-colors"
      >
        {open ? (
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path strokeLinecap="round" d="M5 5l10 10M15 5L5 15" />
          </svg>
        ) : (
          <span className="font-display italic text-2xl text-gold leading-none translate-y-[-1px]">
            L
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed z-50 bottom-24 right-4 lg:right-8 w-[calc(100vw-2rem)] sm:w-[26rem] max-w-[26rem] h-[34rem] max-h-[calc(100vh-7rem)] bg-ivory border border-gold-soft shadow-2xl flex flex-col">
          {/* Header */}
          <div className="px-5 py-4 border-b border-gold-soft flex flex-col gap-1 bg-ivory-strong/40">
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
              {headerEyebrow}
            </span>
            <h3 className="font-display text-xl text-ink leading-none">
              {headerTitle}
            </h3>
            <p className="text-[11px] text-ink/60 leading-snug">
              {headerSubtitle}
            </p>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4"
          >
            {messages.length === 0 && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <p className="font-display text-base text-ink">{emptyTitle}</p>
                  <p className="text-sm text-ink/70 leading-relaxed">
                    {emptyBody}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => submit(s)}
                      className="text-left text-xs text-ink/75 border border-gold-soft px-3 py-2 hover:border-gold hover:text-ink transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) => {
              const text = messageText(m);
              const showToolNotice = hasActiveToolCall(m) && !text;
              return (
                <div
                  key={m.id}
                  className={`flex flex-col gap-1 ${
                    m.role === "user" ? "items-end" : "items-start"
                  }`}
                >
                  <span className="text-[9px] uppercase tracking-[0.22em] text-ink/45">
                    {m.role === "user" ? "You" : "Loui"}
                  </span>
                  <div
                    className={`max-w-[85%] text-sm leading-relaxed px-3 py-2 whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-ink text-ivory"
                        : "bg-ivory-strong/60 text-ink border border-gold-soft"
                    }`}
                  >
                    {showToolNotice ? (
                      <span className="italic text-ink/55">{toolNotice}</span>
                    ) : (
                      text
                    )}
                  </div>
                </div>
              );
            })}

            {isStreaming && messages[messages.length - 1]?.role === "user" && (
              <div className="flex flex-col gap-1 items-start">
                <span className="text-[9px] uppercase tracking-[0.22em] text-ink/45">
                  Loui
                </span>
                <div className="bg-ivory-strong/60 border border-gold-soft text-ink/55 italic text-sm px-3 py-2">
                  …
                </div>
              </div>
            )}

            {error && (
              <div className="text-xs text-red-700 italic">
                {error.message}
              </div>
            )}
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
            className="border-t border-gold-soft p-3 flex flex-col gap-2"
          >
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={placeholder}
                disabled={isStreaming}
                className="flex-1 border border-gold-soft bg-ivory px-3 py-2 text-sm text-ink focus:outline-none focus:border-gold disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!input.trim() || isStreaming}
                className="px-4 py-2 bg-ink text-ivory text-[10px] font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {sendLabel}
              </button>
            </div>
            <p className="text-[10px] text-ink/45 leading-snug">{disclaimer}</p>
          </form>
        </div>
      )}
    </>
  );
}
