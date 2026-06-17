// Pluggable tour-processing abstraction (see docs/tour-premium-architecture.md).
// Every engine (Veo "Living Listing" video, future Replicate/Modal 3DGS) is one
// TourProcessor; the routes depend only on this interface and select an engine
// via the TOUR_ENGINE env var. Swapping engines is config + one adapter file.

export type TourKind = "gaussian_splat" | "video";

/** How an engine reports completion. */
export type TourEngineMode =
  // Runs to completion within start() and returns the asset inline (e.g. Veo:
  // a long-running operation we poll in-memory). Simple; the request blocks.
  | "synchronous"
  // Processes async and calls us back; finish via parseCallback().
  | "webhook";

export interface TourJobInput {
  /** our tour_jobs.id */
  jobId: string;
  propertyId: string;
  /**
   * Source media. For Living Listing (image-to-video) this is the REAL property
   * photo, used as the first frame / source of truth. A 3DGS engine would pass a
   * walkthrough video URL instead.
   */
  imageUrl: string;
  /** Webhook URL for async engines. Ignored by synchronous engines (Veo). */
  callbackUrl: string;
}

export interface TourStartResult {
  /** the engine's own job/operation id → persisted to tour_jobs.vendor_job_id */
  vendorJobId: string;
  status: "processing" | "ready" | "failed";
  /** Synchronous engines (Veo) return the rendered asset inline when ready. */
  bytes?: Uint8Array;
  /** mime type of `bytes`, e.g. "video/mp4" */
  mimeType?: string;
  error?: string;
}

export interface TourCallbackResult {
  vendorJobId: string;
  status: "ready" | "failed";
  /** URL the engine produced (webhook engines that host the output). */
  outputUrl?: string;
  error?: string;
}

export interface TourProcessor {
  /** registry key, also stored in tour_jobs.vendor (e.g. "gemini-video") */
  readonly id: string;
  readonly kind: TourKind;
  readonly mode: TourEngineMode;
  /** Kick off (and, for synchronous engines, run) generation for one job. */
  start(input: TourJobInput): Promise<TourStartResult>;
  /** Webhook engines only: parse an inbound callback into a normalized result. */
  parseCallback?(body: unknown): TourCallbackResult;
}
