// F3-A Step 1 — pure media-metadata contract. The technically-observed facts about a
// source video, as they would be read from ffprobe. NO ffprobe/FFmpeg execution here —
// this is only the SHAPE the (later) preparation layer parses into and the limit checker
// (video-source-limits.ts) consumes. Kept dependency-free so both the source-strategy
// contract and the limit checker can import it without a cycle.
//
// This module is a CONTRACT ONLY: nothing in the production render path imports it yet
// (the real ffprobe parsing + validation land in a later, separately-authorized step),
// so it contributes zero runtime behavior change.

export interface SourceVideoMetadata {
  // ffprobe `format.format_name` (a comma-separated alias list for MP4, e.g.
  // "mov,mp4,m4a,3gp,3g2,mj2") — membership-checked, never equality-checked, by the
  // limit checker.
  container: string;
  // ffprobe video-stream `codec_name` (e.g. "h264"); null when there is NO video stream.
  videoCodec: string | null;
  // ffprobe audio-stream `codec_name` (e.g. "aac"); null when there is NO audio stream
  // (audio is optional — gate §10).
  audioCodec: string | null;
  // CODED pixel dimensions (pre-rotation). Orientation is carried separately in
  // `rotationDegrees`; the limit checker is orientation-agnostic (it sorts the edges), so
  // a 4K clip is bounded the same whether it is 3840×2160 or 2160×3840.
  width: number;
  height: number;
  // Frames per second, already reduced from ffprobe's rational `r_frame_rate` ("30/1").
  fps: number;
  durationSeconds: number;
  bytes: number;
  // Display rotation from container metadata / side-data (0 | 90 | 180 | 270). Applied by
  // the preparation step, not by the limit check.
  rotationDegrees: number;
  // Etapa 1 (2026-08-05) — señales de color del SOURCE, para detectar HDR. Opcionales: un
  // metadata sin ellas (o con null) NO es HDR — solo una señal POSITIVA lo es (misma
  // postura que ADR-0011 frente al rango de color: nunca se adivina, nunca se penaliza lo
  // no etiquetado). ffprobe: color_transfer / color_primaries / color_space, y
  // side_data_list con "DOVI configuration record" para Dolby Vision.
  colorTransfer?: string | null;
  colorPrimaries?: string | null;
  colorSpace?: string | null;
  dolbyVision?: boolean;
}
