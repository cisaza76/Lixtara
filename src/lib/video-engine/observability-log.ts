// Issue #112 — structured JSON logging for the video worker path. House pattern:
// src/lib/ratelimit.ts#logProviderFailure (PR #104). Single-line JSON with a stable
// `event` discriminator so Vercel function logs become grep/parse-able:
//   video_job_failed            — one line per classified job failure
//   video_worker_run            — one line per worker invocation (claimed/processed/recovered)
//   video_worker_internal_error — the previously-silent pipeline-bug catch
//
// Doctrine (same as the rate-limit logger): observability must never cause a failure
// and must never be fully silent — on serialization trouble it degrades to a minimal
// line rather than throwing or dropping the event.

const ERROR_SEVERITY_EVENTS = new Set(["video_job_failed", "video_worker_internal_error"]);

function redactString(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, "[url omitted]").replace(/sb_secret_\S+/gi, "[secret omitted]");
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  return value;
}

export function logVideoEvent(event: string, fields: Record<string, unknown>): void {
  const sink = ERROR_SEVERITY_EVENTS.has(event) ? console.error : console.log;
  try {
    const payload: Record<string, unknown> = {
      event,
      env: process.env.VERCEL_ENV ?? "development",
      timestamp: new Date().toISOString(),
    };
    for (const [key, value] of Object.entries(fields ?? {})) {
      if (value === undefined) continue;
      payload[key] = redactValue(value);
    }
    sink(JSON.stringify(payload));
  } catch {
    try {
      sink(JSON.stringify({ event, note: "payload_unserializable", timestamp: new Date().toISOString() }));
    } catch {
      // even the fallback failed — give up silently rather than throw into the pipeline
    }
  }
}
