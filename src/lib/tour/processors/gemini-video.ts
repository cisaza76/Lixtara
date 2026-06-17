// Gemini / Veo "Living Listing" engine: image-to-video from a REAL listing
// photo with a subtle cinematic camera move. Server-only (reads GEMINI_API_KEY;
// never NEXT_PUBLIC). This engine is SYNCHRONOUS — Veo returns a long-running
// operation we poll in-memory to completion and return the video bytes.
//
// NOTE (exact API): @google/genai's video surface is in paid preview and may
// shift between SDK versions. The calls below follow the documented shape
// (ai.models.generateVideos → poll ai.operations.getVideosOperation →
// response.generatedVideos[0].video). If a version differs, only this file
// needs adjusting; the abstraction and routes are unaffected.

import { GoogleGenAI } from "@google/genai";
import type {
  TourCallbackResult,
  TourJobInput,
  TourProcessor,
  TourStartResult,
} from "../processor";

// Veo model id — overridable without a code change.
const VEO_MODEL = process.env.VEO_MODEL ?? "veo-3.1-generate-preview";

// The "source of truth" prompt. Every rule is a guardrail against the model
// inventing anything that isn't in the seller's real photo.
export const LIVING_LISTING_PROMPT = [
  "Generate a SUBTLE cinematic real-estate micro-clip from this single real",
  "property photo. The uploaded image is the SOURCE OF TRUTH.",
  "",
  "Motion: a slow, smooth push-in or a very subtle dolly. Gentle and premium —",
  "luxury listing style. Keep it short (about 4 seconds).",
  "",
  "STRICT RULES — do not violate:",
  "- Do NOT add rooms.",
  "- Do NOT add furniture or decor.",
  "- Do NOT alter the architecture, layout, materials, or proportions.",
  "- Do NOT reveal any area outside the original image's framing.",
  "- Preserve the exact layout, materials, lighting, colors, and proportions.",
  "- No people, no text, no logos, no watermarks.",
  "Photorealistic and faithful to the source image. If in doubt, move the camera less.",
].join("\n");

// Lazy client — constructing at module load would crash any import when the key
// is absent (e.g. local dev without GEMINI_API_KEY). Build it on first use.
let _client: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (!_client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
    _client = new GoogleGenAI({ apiKey });
  }
  return _client;
}

async function fetchImageAsBase64(
  url: string,
): Promise<{ data: string; mimeType: string }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`source image fetch failed: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return {
    data: buf.toString("base64"),
    mimeType: r.headers.get("content-type") ?? "image/jpeg",
  };
}

// The operation's runtime shape we rely on (kept narrow + defensive so a minor
// SDK change doesn't break compilation).
interface VeoOperationLike {
  done?: boolean;
  name?: string;
  error?: { code?: number; message?: string } | null;
  response?: {
    generatedVideos?: Array<{
      video?: { videoBytes?: string; uri?: string; mimeType?: string };
    }>;
  };
}

export const geminiVideoProcessor: TourProcessor = {
  id: "gemini-video",
  kind: "video",
  mode: "synchronous",

  async start(input: TourJobInput): Promise<TourStartResult> {
    const ai = client();
    const img = await fetchImageAsBase64(input.imageUrl);

    // Kick off Veo image-to-video using the real photo as the first frame.
    let operation = (await ai.models.generateVideos({
      model: VEO_MODEL,
      prompt: LIVING_LISTING_PROMPT,
      image: { imageBytes: img.data, mimeType: img.mimeType },
      config: { numberOfVideos: 1, aspectRatio: "16:9" },
    })) as unknown as VeoOperationLike;

    const vendorJobId = operation.name ?? input.jobId;

    // Poll the long-running operation to completion, in-memory. Veo is ~1–3 min;
    // the caller's route sets maxDuration to stay within bounds.
    // TODO(scale): move generation to a background worker + a resume/poll route
    // so the HTTP request returns immediately instead of blocking.
    const deadline = Date.now() + 280_000;
    while (!operation.done && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10_000));
      operation = (await ai.operations.getVideosOperation({
        operation: operation as unknown as Parameters<
          typeof ai.operations.getVideosOperation
        >[0]["operation"],
      })) as unknown as VeoOperationLike;
    }

    if (!operation.done) {
      // Timed out within this request — leave it processing; a future poll route
      // can resume. (Synchronous engine, so this is the slow-path fallback.)
      return { vendorJobId, status: "processing" };
    }
    if (operation.error) {
      return {
        vendorJobId,
        status: "failed",
        error: operation.error.message ?? "veo_generation_failed",
      };
    }

    const video = operation.response?.generatedVideos?.[0]?.video;
    const mimeType = video?.mimeType ?? "video/mp4";

    if (video?.videoBytes) {
      return {
        vendorJobId,
        status: "ready",
        bytes: new Uint8Array(Buffer.from(video.videoBytes, "base64")),
        mimeType,
      };
    }
    // Some responses return a download URI instead of inline bytes.
    if (video?.uri) {
      const sep = video.uri.includes("?") ? "&" : "?";
      const dl = video.uri.includes("key=")
        ? video.uri
        : `${video.uri}${sep}key=${process.env.GEMINI_API_KEY}`;
      const r = await fetch(dl);
      if (r.ok) {
        return {
          vendorJobId,
          status: "ready",
          bytes: new Uint8Array(await r.arrayBuffer()),
          mimeType,
        };
      }
    }
    return { vendorJobId, status: "failed", error: "veo returned no video" };
  },

  // Present for the webhook route + future async engines; Veo is synchronous so
  // it normally finishes inside start(). Kept so a callback (if ever sent) maps
  // cleanly.
  parseCallback(body: unknown): TourCallbackResult {
    const d = (body ?? {}) as {
      vendorJobId?: string;
      status?: "ready" | "failed";
      outputUrl?: string;
      error?: string;
    };
    return {
      vendorJobId: d.vendorJobId ?? "unknown",
      status: d.status === "ready" ? "ready" : "failed",
      outputUrl: d.outputUrl,
      error: d.error,
    };
  },
};
