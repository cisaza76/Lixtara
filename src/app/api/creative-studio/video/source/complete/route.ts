// POST /api/creative-studio/video/source/complete — Phase B of the seller source-video
// upload. After the client uploaded directly to the signed URL, this route verifies the
// REAL stored object (size/mime from Storage, never the client), creates the durable Source
// Asset that F3's resolveVideoSource already consumes (kind=video, source_type=seller_upload),
// writes an audit row, and is IDEMPOTENT (repeat = same asset, no duplicate, no false audit).
// It does NOT start preparation/render/QA and creates NO creative job.
//
// Flag-gated by CREATIVE_STUDIO_VIDEO_ENABLED (fail-closed 404).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createService } from "@/lib/supabase/service";
import { apiLimiter, enforceLimit } from "@/lib/ratelimit";
import { createAsset } from "@/lib/assets/asset-manager";
import type { Asset, AssetStore } from "@/lib/assets/types";
import { SupabaseAssetStore, UniqueViolationError } from "@/lib/assets/asset-store.supabase";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-errors";
import {
  SOURCE_ASSET_KIND,
  SOURCE_ASSET_SOURCE_TYPE,
  SOURCE_BUCKET,
  buildSourceStoragePath,
  sourceExtFromStoragePath,
  mimeForSourceExt,
  isCreativeStudioVideoEnabled,
  isExpectedSourcePath,
  isUuid,
  sourceAssetIdentity,
  validateStoredObject,
  type StoredObjectMeta,
} from "@/lib/creative-studio/source-upload";
import {
  ensureVideoSourceUploadedAudit,
  VIDEO_SOURCE_UPLOADED_ACTION,
  type AuditPort,
} from "@/lib/creative-studio/source-audit";
import { checkVideoAccess, videoVisibilityDenial, type CheckVideoAccess } from "@/lib/creative-studio/video-access-guard";

interface Body {
  listingId?: unknown;
  assetId?: unknown;
  storagePath?: unknown;
}
interface PropertyRow {
  id: string;
  owner_id: string;
}

export interface CompleteSourceDeps {
  getUser(): Promise<{ id: string } | null>;
  loadProperty(propertyId: string): Promise<PropertyRow | null>;
  checkRateLimit(userId: string): Promise<Response | null>;
  assets: AssetStore;
  statObject(bucket: string, path: string): Promise<StoredObjectMeta>;
  // Idempotent, repairable audit (correction 1): find-or-insert the single durable event.
  auditPort: AuditPort;
  // Gate 5 visibility: an allowlisted, in-scope seller only (quota does NOT gate finalizing upload).
  checkAccess: CheckVideoAccess;
}

function defaultDeps(): CompleteSourceDeps {
  let clientPromise: ReturnType<typeof createClient> | null = null;
  const client = () => (clientPromise ??= createClient());
  return {
    async getUser() {
      const supabase = await client();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user ? { id: user.id } : null;
    },
    async loadProperty(propertyId) {
      const supabase = await client();
      const { data } = await supabase.from("properties").select("id, owner_id").eq("id", propertyId).maybeSingle();
      return (data as PropertyRow | null) ?? null;
    },
    async checkRateLimit(userId) {
      return enforceLimit(apiLimiter("creative-studio:video:source:complete", 20, "1 h"), `u:${userId}`, {
        label: "creative-studio:video:source:complete",
        message: "Too many requests. Please wait.",
      });
    },
    assets: new SupabaseAssetStore(createService()),
    async statObject(bucket, path) {
      const slash = path.lastIndexOf("/");
      const dir = path.slice(0, slash);
      const name = path.slice(slash + 1);
      const { data, error } = await createService().storage.from(bucket).list(dir, { limit: 100, search: name });
      if (error || !data) return { exists: false, sizeBytes: 0, mimeType: null };
      const obj = data.find((o) => o.name === name);
      if (!obj) return { exists: false, sizeBytes: 0, mimeType: null };
      const md = (obj.metadata ?? null) as { size?: number; mimetype?: string } | null;
      return { exists: true, sizeBytes: Number(md?.size ?? 0), mimeType: md?.mimetype ?? null };
    },
    auditPort: {
      async exists({ userId, listingId, uploadId }) {
        const { data } = await createService()
          .from("activity_log")
          .select("id")
          .eq("action_type", VIDEO_SOURCE_UPLOADED_ACTION)
          .eq("user_id", userId)
          .eq("property_id", listingId)
          .eq("metadata->>uploadId", uploadId)
          .limit(1)
          .maybeSingle();
        return Boolean(data);
      },
      async insert(entry) {
        // Non-sensitive metadata only — NEVER the signed URL/token/credentials. A
        // 23505 (from the authored partial unique index) means a concurrent insert won —
        // surfaced as UniqueViolationError so the ensure-helper treats it as done.
        const { error } = await createService()
          .from("activity_log")
          .insert({
            user_id: entry.userId,
            property_id: entry.listingId,
            action_type: VIDEO_SOURCE_UPLOADED_ACTION,
            description: "Seller uploaded a source video",
            metadata: {
              uploadId: entry.uploadId,
              assetId: entry.assetId,
              sizeBytes: entry.sizeBytes,
              mimeType: entry.mimeType,
              bucket: SOURCE_BUCKET,
              sourceType: SOURCE_ASSET_SOURCE_TYPE,
            },
          });
        if (error) {
          if (error.code === PG_UNIQUE_VIOLATION) throw new UniqueViolationError(error.message ?? "duplicate audit");
          throw new Error(`activity_log insert failed: ${error.message ?? "unknown error"}`);
        }
      },
    },
    checkAccess: checkVideoAccess,
  };
}

function alreadyRegistered(asset: Asset, uploadId: string): Response {
  return NextResponse.json({ assetId: asset.id, uploadId, status: "already_registered" }, { status: 200 });
}

export async function handleCompleteSourceUpload(req: Request, deps: CompleteSourceDeps): Promise<Response> {
  const user = await deps.getUser();
  if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const limited = await deps.checkRateLimit(user.id);
  if (limited) return limited;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!isUuid(body.listingId) || !isUuid(body.assetId)) {
    return NextResponse.json({ error: "invalid_ids" }, { status: 400 });
  }
  const listingId = body.listingId as string;
  const uploadId = body.assetId as string;

  const property = await deps.loadProperty(listingId);
  if (!property || property.owner_id !== user.id) {
    return NextResponse.json({ error: "listing_not_found_or_not_yours" }, { status: 403 });
  }

  // Gate 5 access (after ownership): invisible (404) to a non-allowlisted / out-of-scope seller;
  // quota does NOT gate finalizing an already-uploaded object (videoVisibilityDenial).
  const denial = videoVisibilityDenial(await deps.checkAccess({ userId: user.id, listingId }));
  if (denial) return NextResponse.json(denial.body, { status: denial.status });

  // Path security: the client-supplied path must EXACTLY match the server namespace.
  if (!isExpectedSourcePath(body.storagePath, user.id, listingId, uploadId)) {
    return NextResponse.json({ error: "invalid_storage_path" }, { status: 403 });
  }
  // Etapa 1 — la extensión del key la fija el servidor dentro del set cerrado; se deriva
  // del path YA validado (isExpectedSourcePath probó que es byte-igual a uno de los dos
  // candidatos server-built), nunca de texto libre del cliente.
  const sourceExt = sourceExtFromStoragePath(String(body.storagePath));
  const expectedPath = buildSourceStoragePath(user.id, listingId, uploadId, sourceExt);

  const identity = sourceAssetIdentity(uploadId);

  // Correction 1: /complete must guarantee BOTH a durable Asset AND a durable audit event.
  // This find-or-insert (idempotent, concurrency-safe via the authored partial unique index)
  // is called in every success path — including the "already registered" one, so an audit
  // lost to a prior partial /complete is REPAIRED. If it cannot be ensured after internal
  // retries: 503 retryable, the Asset is KEPT (never deleted), and we do NOT claim complete.
  const ensureAudit = async (a: Asset): Promise<Response | null> => {
    const { ensured } = await ensureVideoSourceUploadedAudit(deps.auditPort, {
      userId: user.id,
      listingId,
      uploadId,
      assetId: a.id,
      sizeBytes: a.bytes,
      mimeType: a.mime,
    });
    return ensured ? null : NextResponse.json({ error: "audit_not_ensured", retryable: true }, { status: 503 });
  };

  // Idempotency: a prior complete already registered it.
  const existing = await deps.assets.findBySource(identity.sourceType, identity.sourceId);
  if (existing) {
    // A globally-unique uploadId reused against a DIFFERENT listing/owner is a conflict, not
    // an idempotent repeat — never hand back another listing's source (no audit written).
    if (existing.listingId !== listingId || existing.ownerId !== user.id) {
      return NextResponse.json({ error: "asset_id_conflict" }, { status: 409 });
    }
    return (await ensureAudit(existing)) ?? alreadyRegistered(existing, uploadId);
  }

  // Verify the REAL stored object (never trust client-sent size/mime).
  const meta = await deps.statObject(SOURCE_BUCKET, expectedPath);
  const objOk = validateStoredObject(meta);
  if (!objOk.ok) {
    const status = objOk.error === "object_not_found" ? 409 : 400;
    return NextResponse.json({ error: objOk.error }, { status });
  }

  // Create the durable Source Asset — exactly the shape F3's resolveVideoSource consumes.
  // lifecycle "draft" (received + available, NOT yet technically validated): this cheap
  // gate only proved the object exists, is within the size limit, is stored as video/mp4,
  // and sits in the right namespace. Codec/container/duration/resolution/fps/decode/rotation
  // are F3's `validating` stage — "approved" would falsely claim a technical approval this
  // step never performed.
  let asset: Asset;
  try {
    asset = await createAsset(deps.assets, {
      listingId,
      ownerId: user.id,
      kind: SOURCE_ASSET_KIND,
      version: 1,
      parentAsset: null,
      sourceType: SOURCE_ASSET_SOURCE_TYPE,
      sourceId: uploadId, // stable idempotency key via assets_source_unique
      provenance: { sourceAssetIds: [], capability: "video", engine: "asset-manager", provider: "seller_upload", prompt: null },
      storageBucket: SOURCE_BUCKET,
      storagePath: expectedPath,
      bytes: meta.sizeBytes,
      mime: meta.mimeType ?? mimeForSourceExt(sourceExt),
      costUsd: 0,
      costProvider: null,
      createdBy: user.id,
      lifecycle: "draft",
    });
  } catch (err) {
    // Lost an idempotency race (unique violation): adopt the winner + ensure its audit.
    if (err instanceof UniqueViolationError) {
      const winner = await deps.assets.findBySource(identity.sourceType, identity.sourceId);
      if (winner) return (await ensureAudit(winner)) ?? alreadyRegistered(winner, uploadId);
    }
    // Asset creation failed → NO audit (never a false success).
    return NextResponse.json({ error: "asset_create_failed" }, { status: 500 });
  }

  // Asset durable → guarantee the audit event before claiming the operation complete.
  return (await ensureAudit(asset)) ?? NextResponse.json({ assetId: asset.id, uploadId, registered: true }, { status: 200 });
}

export async function POST(req: Request): Promise<Response> {
  if (!isCreativeStudioVideoEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return handleCompleteSourceUpload(req, defaultDeps());
}
