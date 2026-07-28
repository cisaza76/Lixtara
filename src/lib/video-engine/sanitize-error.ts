// Issue #112 — error-message sanitation with TAIL preservation. The diagnostic payload
// of pipeline errors (ffmpeg / render-script stderr) is captured at the SOURCE by the
// tail (`.slice(-4000)` — the fatal line is always at the end of stderr); the previous
// sanitizer then truncated by the HEAD (`.slice(0, 500)`), systematically discarding
// that fatal line. This module keeps prefix context AND the tail, redacts the known
// leak shapes, and never throws — observability must never become the incident.

const MESSAGE_CAP = 500;
const HEAD_KEEP = 150;
const CAUSE_DEPTH_CAP = 5;

function redact(raw: string): string {
  return raw.replace(/https?:\/\/\S+/gi, "[url omitted]").replace(/sb_secret_\S+/gi, "[secret omitted]");
}

function toMessage(err: unknown): string {
  try {
    if (err instanceof Error) return err.message;
    return String(err);
  } catch {
    return "[unprintable error]";
  }
}

// Redact FIRST, then cap. Under the cap the message is kept whole; over it, keep the
// head (context prefix: which component, which exit code) plus the tail (the fatal
// line), joined by an explicit elision marker.
export function sanitizeErrorMessage(err: unknown): string {
  try {
    const clean = redact(toMessage(err));
    if (clean.length <= MESSAGE_CAP) return clean;
    const tailKeep = MESSAGE_CAP - HEAD_KEEP - 3; // 3 = " … "
    return `${clean.slice(0, HEAD_KEEP)} … ${clean.slice(-tailKeep)}`;
  } catch {
    return "[sanitizer failed]";
  }
}

// Larger-budget tail for the evidence pack (transitions.metadata jsonb — not the
// 500-char error_message column): keeps the END of a stderr-style message, redacted.
export function sanitizeStderrTail(err: unknown, cap = 2000): string {
  try {
    return redact(toMessage(err)).slice(-cap);
  } catch {
    return "";
  }
}

// The `cause` chain is free diagnostic depth every typed pipeline error already carries
// — walk it (bounded, cycle-safe), sanitizing each hop. Returns [] on anything odd.
export function sanitizedCauseChain(err: unknown): string[] {
  const chain: string[] = [];
  try {
    const seen = new Set<unknown>();
    let cursor: unknown = err instanceof Error ? err.cause : undefined;
    while (cursor !== undefined && cursor !== null && chain.length < CAUSE_DEPTH_CAP) {
      if (seen.has(cursor)) break;
      seen.add(cursor);
      chain.push(sanitizeErrorMessage(cursor));
      cursor = cursor instanceof Error ? cursor.cause : undefined;
    }
  } catch {
    // partial chain (possibly empty) is fine — never throw from observability code
  }
  return chain;
}
