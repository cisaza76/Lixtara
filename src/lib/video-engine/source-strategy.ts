// F3-A Step 1 — the Source Strategy contract + registry (Seam A/B of the two-axis design,
// ADR-0001 / F2-A). A source strategy answers "where does the body content come from?" and
// "how is it prepared for the shared composition?" — independent of the Render Profile
// ("what output shape?"). CONTRACT ONLY: no selection/preparation logic, no I/O, no FFmpeg
// here (those are later steps). Nothing in the production path imports this yet → zero
// behavior change.
import type { CompositionInput, CompositionInputSource } from "@/lib/video-engine/composition-input";
import type { SourceVideoMetadata } from "@/lib/video-engine/media-metadata";

export const SOURCE_STRATEGIES = ["photo_slideshow", "uploaded_video"] as const;
export type SourceStrategy = (typeof SOURCE_STRATEGIES)[number];

// ---------------------------------------------------------------------------
// Seam A — SelectedSource: what a strategy LOCATED + AUTHORIZED as its source, before any
// download/preparation. Discriminated on `strategy`.
// ---------------------------------------------------------------------------
export interface SelectedPhoto {
  assetId: string;
  storageBucket: string;
  storagePath: string;
  roomLabel?: string;
}

export interface SelectedUploadedVideo {
  assetId: string;
  listingId: string;
  ownerId: string;
  storageBucket: string;
  storagePath: string;
  bytes: number;
  mime: string;
}

export type SelectedSource =
  | { strategy: "photo_slideshow"; photos: SelectedPhoto[] }
  | { strategy: "uploaded_video"; asset: SelectedUploadedVideo };

// ---------------------------------------------------------------------------
// Seam B — PreparedSource: ready to hand to the shared composition. For uploaded_video the
// preparation step (a later, FFmpeg-backed module) produces a PreparedVideoSource that is
// ALREADY normalized to the output frame; NO visual decision (aspect/rotation/blurred-fill/
// letterbox) is exposed to Remotion.
// ---------------------------------------------------------------------------
export interface PreparedPhoto {
  // Host-local path of the downloaded (+ downscaled) source photo.
  localPath: string;
  // Bundle-relative ref the composition addresses via staticFile().
  stagedRef: string;
  roomLabel?: string;
}

// The exact shape the gate specified. `path` is an INTERNAL temporary runtime reference to
// the ephemeral prepared file inside the job's sandbox workspace (D2) — NEVER a public URL,
// NEVER a durable/reusable address outside the job. It is regenerated from the durable
// source Asset on every retry.
export interface PreparedVideoSource {
  path: string;
  width: 1920;
  height: 1080;
  fps: 30;
  durationSeconds: number;
  videoCodec: "h264";
  audioCodec: "aac" | null;
  hasAudio: boolean;
  // sha256 of the DURABLE source bytes — the retry-stable identity of what was prepared.
  sourceHash: string;
  // Deterministic hash of the preparation plan (ffmpeg args + limits + tool versions) — two
  // runs that would produce the same prepared file share this fingerprint.
  preparationFingerprint: string;
  // --- provenance (gate D2) ---
  sourceMetadata: SourceVideoMetadata;
  // Human-readable applied transforms, e.g. ["rotate 90°", "blurred-fill 9:16→16:9", "fps 24→30"].
  transformations: string[];
  ffmpegVersion: string;
  // Runtime identity: the base-artifact snapshot tag + the pinned Remotion/@remotion/media
  // versions the prepare+render ran under.
  runtimeVersion: string;
  // Ephemeral temporary size (bytes) of the prepared file — for metrics, not persisted as an
  // Asset.
  preparedBytes: number;
}

export type PreparedSource =
  | { strategy: "photo_slideshow"; photos: PreparedPhoto[] }
  | { strategy: "uploaded_video"; video: PreparedVideoSource };

// ---------------------------------------------------------------------------
// Strategy registry — metadata only (proves strategies are enumerable and structurally
// independent of Render Profiles). The concrete select/prepare functions bind in later
// steps; this registry is the stable descriptor table.
// ---------------------------------------------------------------------------
export interface SourceStrategyDescriptor {
  id: SourceStrategy;
  // uploaded_video needs an FFmpeg normalization pre-pass; photo_slideshow does not.
  requiresPreparation: boolean;
  // The kind of Asset the strategy consumes as its source.
  sourceKind: "photo" | "video";
  // The CompositionInput arm this strategy produces (must match a CompositionInputSource).
  compositionInputSource: CompositionInputSource;
}

export const SOURCE_STRATEGY_REGISTRY: Record<SourceStrategy, SourceStrategyDescriptor> = {
  photo_slideshow: {
    id: "photo_slideshow",
    requiresPreparation: false,
    sourceKind: "photo",
    compositionInputSource: "photo_slideshow",
  },
  uploaded_video: {
    id: "uploaded_video",
    requiresPreparation: true,
    sourceKind: "video",
    compositionInputSource: "uploaded_video",
  },
};

// Narrowing helper the (later) dispatch + tests use — keeps the discriminant mapping in
// one place. Pure.
export function compositionSourceForStrategy(strategy: SourceStrategy): CompositionInput["source"] {
  return SOURCE_STRATEGY_REGISTRY[strategy].compositionInputSource;
}
