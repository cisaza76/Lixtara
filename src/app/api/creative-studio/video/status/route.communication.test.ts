import { describe, expect, it } from "vitest";
import type { CreativeJob } from "@/lib/creative-jobs/jobs";
import type { Asset } from "@/lib/assets/types";
import { handleVideoStatus, type VideoStatusDeps } from "@/app/api/creative-studio/video/status/route";

// UX 5C (approved 2026-07-28) — the status DTO gains `failure` (failed only) and
// `madeFrom` (completed only), with the strict no-leak contract intact: no error_code,
// no category, no stderr, no internal ids ever cross this boundary.

const OWNER = { id: "owner-1" };
const LISTING = "listing-1";

function job(over: Partial<CreativeJob> = {}): CreativeJob {
  return {
    id: "job-1",
    listingId: LISTING,
    ownerId: OWNER.id,
    capability: "video",
    state: "failed",
    assetId: null,
    idempotencyKey: "k",
    attempts: 1,
    maxAttempts: 3,
    claimedAt: null,
    claimedBy: null,
    heartbeatAt: null,
    cancellationRequested: false,
    timeoutMs: 600000,
    errorCode: "RENDER_TIMEOUT",
    errorMessage: "SandboxRemotionProvider: render timed out after 300000ms (SIGKILL): boring stderr",
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:01:00.000Z",
    traceId: "trace-abc",
    ...over,
  };
}

function completedAsset(strategy: string): Asset {
  return {
    id: "asset-1",
    listingId: LISTING,
    ownerId: OWNER.id,
    kind: "video",
    version: 1,
    parentAsset: null,
    sourceType: "generated",
    sourceId: null,
    provenance: { sourceAssetIds: ["s"], capability: "video", engine: "video-engine", provider: "remotion", prompt: null, sourceStrategy: strategy } as unknown as Asset["provenance"],
    storageBucket: "creative-studio",
    storagePath: "p.mp4",
    checksum: "c",
    bytes: 1,
    mime: "video/mp4",
    costUsd: 0,
    costProvider: null,
    createdBy: OWNER.id,
    lifecycle: "ready_for_review",
    qa: null,
    policy: null,
    createdAt: "2026-07-28T00:02:00.000Z",
  };
}

function deps(over: Partial<VideoStatusDeps> = {}): VideoStatusDeps {
  return {
    getUser: async () => OWNER,
    loadProperty: async () => ({ id: LISTING, owner_id: OWNER.id }),
    findLatestByListing: async () => job(),
    getAsset: async () => null,
    signUrls: async () => ({ previewUrl: "https://x/p", downloadUrl: "https://x/d" }),
    checkAccess: async () => ({
      allowed: true,
      reason: "ok",
      userAllowed: true,
      listingAllowed: true,
      remainingGenerations: 2,
      consentRequired: false,
      consentSatisfied: true,
    }),
    listRecentTerminalJobs: async () => [],
    ...over,
  } as VideoStatusDeps;
}

const REQ = new Request(`https://app/api?property_id=${LISTING}`);

describe("UX 5C — status DTO failure object", () => {
  it("failed job exposes {kind, reference, canRetry, supportPrimary} and NOTHING technical", async () => {
    const res = await handleVideoStatus(REQ, deps());
    const body = await res.json();
    expect(body.state).toBe("failed");
    expect(body.failure).toEqual({
      kind: "technical_retryable",
      reference: expect.stringMatching(/^[A-F0-9]{8}$/),
      canRetry: true,
      supportPrimary: false,
    });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("RENDER_TIMEOUT");
    expect(raw).not.toContain("stderr");
    expect(raw).not.toContain("trace-abc");
    expect(raw).not.toContain("SIGKILL");
    expect(raw).not.toContain("job-1");
  });

  it("source-actionable failure: kind=source_action_required, canRetry=false", async () => {
    const res = await handleVideoStatus(REQ, deps({ findLatestByListing: async () => job({ errorCode: "VIDEO_CORRUPT" }) }));
    const body = await res.json();
    expect(body.failure.kind).toBe("source_action_required");
    expect(body.failure.canRetry).toBe(false);
  });

  it("capacity exhausted: canRetry=false, supportPrimary=true (no dead CTA, no 404)", async () => {
    const res = await handleVideoStatus(
      REQ,
      deps({
        checkAccess: async () => ({
          allowed: false,
          reason: "quota_exhausted",
          userAllowed: true,
          listingAllowed: true,
          remainingGenerations: 0,
          consentRequired: false,
          consentSatisfied: true,
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.failure.canRetry).toBe(false);
    expect(body.failure.supportPrimary).toBe(true);
  });

  it("second consecutive equivalent failure: supportPrimary=true", async () => {
    const res = await handleVideoStatus(
      REQ,
      deps({
        listRecentTerminalJobs: async () => [
          { state: "failed", errorCode: "RENDER_TIMEOUT", strategy: "photo_slideshow", sourceAssetId: null },
          { state: "failed", errorCode: "SANDBOX_CREATE_FAILED", strategy: "photo_slideshow", sourceAssetId: null },
        ],
      }),
    );
    const body = await res.json();
    expect(body.failure.supportPrimary).toBe(true);
    expect(body.failure.canRetry).toBe(true); // still retryable + capacity → retry stays secondary
  });

  it("a success BETWEEN failures breaks the consecutive rule", async () => {
    const res = await handleVideoStatus(
      REQ,
      deps({
        listRecentTerminalJobs: async () => [
          { state: "failed", errorCode: "RENDER_TIMEOUT", strategy: "photo_slideshow", sourceAssetId: null },
          { state: "completed", errorCode: null, strategy: "photo_slideshow", sourceAssetId: null },
        ],
      }),
    );
    const body = await res.json();
    expect(body.failure.supportPrimary).toBe(false);
  });
});

describe("UX 5C — madeFrom chip on completed", () => {
  it("uploaded_video provenance → madeFrom uploaded_video", async () => {
    const res = await handleVideoStatus(
      REQ,
      deps({
        findLatestByListing: async () => job({ state: "completed", assetId: "asset-1", errorCode: null }),
        getAsset: async () => completedAsset("uploaded_video"),
      }),
    );
    const body = await res.json();
    expect(body.state).toBe("completed");
    expect(body.madeFrom).toBe("uploaded_video");
    expect(body.failure).toBeUndefined();
  });

  it("photo provenance (or legacy) → madeFrom photos", async () => {
    const res = await handleVideoStatus(
      REQ,
      deps({
        findLatestByListing: async () => job({ state: "completed", assetId: "asset-1", errorCode: null }),
        getAsset: async () => completedAsset("photo_slideshow"),
      }),
    );
    expect((await (await handleVideoStatus(REQ, deps({ findLatestByListing: async () => job({ state: "completed", assetId: "asset-1", errorCode: null }), getAsset: async () => completedAsset("photo_slideshow") }))).json()).madeFrom).toBe("photos");
  });
});
