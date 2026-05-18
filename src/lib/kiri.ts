// KIRI Engine API wrapper — 3D Gaussian Splatting from video.
// Docs: https://docs.kiriengine.app
//
// Flow:
//   1. submitVideo({ videoBytes, filename }) → serialize (task id)
//   2. KIRI processes async (20–60 min typical)
//   3. Webhook hits us with { status, serialize } OR we poll getJobStatus(serialize)
//   4. When status === 'ready', getDownloadUrl(serialize) → temporary modelUrl
//   5. Download .ply within 3-day retention window or KIRI deletes it (code 2002)

const BASE = "https://api.kiriengine.app/api/v1/open";

function apiKey(): string {
  const k = process.env.KIRI_API_KEY;
  if (!k) throw new Error("KIRI_API_KEY not configured");
  return k;
}

interface KiriEnvelope<T> {
  code: number;
  msg: string;
  data: T;
  ok: boolean;
}

interface KiriBalanceData {
  balance: number;
}

interface KiriSubmitData {
  serialize: string;
  calculateType: number;
}

interface KiriStatusData {
  serialize: string;
  status: number;
}

interface KiriModelData {
  serialize: string;
  modelUrl: string;
}

// KIRI returns 500 with an envelope code for processing/failed states — these
// aren't HTTP errors, they're domain signals. Map them to our own enum so the
// rest of the codebase doesn't need to know KIRI's numeric vocabulary.
export type KiriStatus =
  | "queued"
  | "processing"
  | "ready"
  | "failed"
  | "expired"
  | "unknown";

function mapStatus(rawCode: number, rawStatus?: number): KiriStatus {
  // Envelope codes from /code-details (returned with HTTP 500 wrapper):
  // 2000 processing · 2001 failed · 2002 expired · 2008 queued
  if (rawCode === 2008) return "queued";
  if (rawCode === 2000) return "processing";
  if (rawCode === 2001) return "failed";
  if (rawCode === 2002) return "expired";

  // Successful envelope (code 0 or 200) means data.status reflects real state.
  // Per docs example { status: 2 } corresponds to ready (model downloadable).
  // Status enum from observed behaviour: 0 queued · 1 processing · 2 ready.
  if (rawCode === 0 || rawCode === 200) {
    if (rawStatus === 0) return "queued";
    if (rawStatus === 1) return "processing";
    if (rawStatus === 2) return "ready";
  }
  return "unknown";
}

async function kiriRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: BodyInit,
): Promise<KiriEnvelope<T>> {
  const headers: HeadersInit = {
    Authorization: `Bearer ${apiKey()}`,
  };
  const res = await fetch(`${BASE}${path}`, { method, headers, body });
  // KIRI returns HTTP 500 for some domain errors but still includes JSON
  // envelope — parse regardless of status.
  const json = (await res.json()) as KiriEnvelope<T>;
  if (res.status === 401) throw new Error("KIRI 401 — invalid API key");
  if (res.status === 403) throw new Error("KIRI 403 — insufficient credit");
  return json;
}

export async function getBalance(): Promise<number> {
  const env = await kiriRequest<KiriBalanceData>("GET", "/balance");
  if (!env.data) throw new Error(`KIRI balance unavailable: ${env.msg}`);
  return env.data.balance;
}

export interface SubmitVideoInput {
  videoBytes: Blob | Uint8Array;
  filename: string;
}

export interface SubmitVideoResult {
  serialize: string;
}

export async function submitVideo(
  input: SubmitVideoInput,
): Promise<SubmitVideoResult> {
  const form = new FormData();
  form.append("isMesh", "0");
  form.append("isMask", "0");
  const blob =
    input.videoBytes instanceof Blob
      ? input.videoBytes
      : new Blob([input.videoBytes.buffer as ArrayBuffer], {
          type: "video/mp4",
        });
  form.append("videoFile", blob, input.filename);

  const env = await kiriRequest<KiriSubmitData>("POST", "/3dgs/video", form);
  if (!env.data?.serialize) {
    throw new Error(`KIRI submit failed (code ${env.code}): ${env.msg}`);
  }
  return { serialize: env.data.serialize };
}

export interface JobStatus {
  serialize: string;
  status: KiriStatus;
  rawCode: number;
}

export async function getJobStatus(serialize: string): Promise<JobStatus> {
  const env = await kiriRequest<KiriStatusData>(
    "GET",
    `/model/getStatus?serialize=${encodeURIComponent(serialize)}`,
  );
  return {
    serialize,
    status: mapStatus(env.code, env.data?.status),
    rawCode: env.code,
  };
}

export async function getDownloadUrl(serialize: string): Promise<string> {
  const env = await kiriRequest<KiriModelData>(
    "GET",
    `/model/getModelZip?serialize=${encodeURIComponent(serialize)}`,
  );
  if (!env.data?.modelUrl) {
    if (env.code === 2002) {
      throw new Error("KIRI model expired (past 3-day retention window)");
    }
    throw new Error(`KIRI getModelZip failed (code ${env.code}): ${env.msg}`);
  }
  return env.data.modelUrl;
}

// Webhook verification — KIRI signs each webhook with a shared secret. The
// docs don't yet publish the exact signing header name, so we verify by
// SHA-256(secret + body) for the common pattern; revisit after first real
// webhook lands and we can read the actual header.
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return expected === signatureHeader.replace(/^sha256=/, "");
}
