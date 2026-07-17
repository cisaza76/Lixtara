// Builds the ONLY payload sent into the render Sandbox. Deliberately minimal:
// normalized `inputProps` (already shaped to `listingVideoInputSchema` by the caller —
// this function never reads a listing/seller/user row itself, so it structurally
// cannot leak a field it was never given), pinned versions, a trace id, and
// non-sensitive technical config. Never reads `process.env`, never touches a Supabase
// or Vercel credential — there is nothing here that could smuggle a secret into the
// Sandbox (requirement 2).
import { FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "@/remotion/layout";
import {
  INPUT_SCHEMA_VERSION,
  RENDERER_VERSION,
  RENDER_PROVIDER,
  TEMPLATE_ID,
  TEMPLATE_VERSION,
} from "@/lib/video-engine/versions";

export interface RenderManifestVersions {
  templateId: string;
  templateVersion: string;
  inputSchemaVersion: string;
  rendererVersion: string;
  renderProvider: string;
  bundleVersion: string | null; // unknown until the bundle step reports it
}

export interface RenderManifestTechnical {
  compositionId: string;
  width: number;
  height: number;
  fps: number;
  codec: "h264";
}

export interface RenderManifest {
  inputProps: unknown;
  versions: RenderManifestVersions;
  traceId: string | null;
  technical: RenderManifestTechnical;
}

export interface BuildRenderManifestInput {
  inputProps: unknown;
  traceId: string | null;
  bundleVersion?: string | null;
  // Both default to the pinned versions.ts constants. Real callers (SandboxRemotionProvider)
  // pass their RenderInput's compositionId/templateVersion through explicitly so the
  // manifest reflects what was actually requested, not just what's pinned; unit tests
  // that don't care about this distinction can omit them and get the pinned defaults.
  compositionId?: string;
  templateVersion?: string;
}

export function buildRenderManifest(input: BuildRenderManifestInput): RenderManifest {
  return {
    inputProps: input.inputProps,
    versions: {
      templateId: TEMPLATE_ID,
      templateVersion: input.templateVersion ?? TEMPLATE_VERSION,
      inputSchemaVersion: INPUT_SCHEMA_VERSION,
      rendererVersion: RENDERER_VERSION,
      renderProvider: RENDER_PROVIDER,
      bundleVersion: input.bundleVersion ?? null,
    },
    traceId: input.traceId,
    technical: {
      compositionId: input.compositionId ?? TEMPLATE_ID,
      width: VIDEO_WIDTH,
      height: VIDEO_HEIGHT,
      fps: FPS,
      codec: "h264",
    },
  };
}
