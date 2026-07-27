// POST /api/creative-studio/video/source/initiate — Phase A of the two-phase seller
// source-video upload. Validates the request cheaply, checks ownership, mints the
// server-owned storage namespace + a short-lived SIGNED UPLOAD URL, and returns upload
// instructions. It does NOT create the durable Source Asset (that is /complete, after the
// object actually exists) and NEVER streams the 300 MB file through this route.
//
// Flag-gated by CREATIVE_STUDIO_VIDEO_ENABLED (fail-closed 404, same as the generate route).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createService } from "@/lib/supabase/service";
import { apiLimiter, enforceLimit } from "@/lib/ratelimit";
import {
  SOURCE_BUCKET,
  buildSourceStoragePath,
  isCreativeStudioVideoEnabled,
  validateInitiate,
} from "@/lib/creative-studio/source-upload";
import { checkVideoAccess, videoVisibilityDenial, type CheckVideoAccess } from "@/lib/creative-studio/video-access-guard";

interface Body {
  listingId?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  sizeBytes?: unknown;
}

interface PropertyRow {
  id: string;
  owner_id: string;
}

export interface InitiateSourceDeps {
  getUser(): Promise<{ id: string } | null>;
  // Ownership-scoped read; the handler does the owner_id === user.id comparison itself.
  loadProperty(propertyId: string): Promise<PropertyRow | null>;
  checkRateLimit(userId: string): Promise<Response | null>;
  createSignedUpload(bucket: string, path: string): Promise<{ signedUrl: string; token: string } | { error: string }>;
  generateAssetId(): string;
  // Gate 5 visibility: an allowlisted, in-scope seller only (quota does NOT gate uploading source).
  checkAccess: CheckVideoAccess;
}

function defaultDeps(): InitiateSourceDeps {
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
      return enforceLimit(apiLimiter("creative-studio:video:source:initiate", 20, "1 h"), `u:${userId}`, {
        label: "creative-studio:video:source:initiate",
        message: "Too many upload attempts. Please wait.",
      });
    },
    async createSignedUpload(bucket, path) {
      // Service client: server-side, RLS-independent, never exposed to the browser (only the
      // resulting single-use signed URL + token are returned).
      const { data, error } = await createService().storage.from(bucket).createSignedUploadUrl(path);
      if (error || !data?.signedUrl) return { error: error?.message ?? "signed_upload_url_failed" };
      return { signedUrl: data.signedUrl, token: data.token };
    },
    generateAssetId: () => crypto.randomUUID(),
    checkAccess: checkVideoAccess,
  };
}

export async function handleInitiateSourceUpload(req: Request, deps: InitiateSourceDeps): Promise<Response> {
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

  const valid = validateInitiate(body);
  if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 });
  const listingId = body.listingId as string;

  // Ownership: explicit owner check (an active listing is publicly readable via RLS, so a
  // returned row is not proof of ownership).
  const property = await deps.loadProperty(listingId);
  if (!property || property.owner_id !== user.id) {
    return NextResponse.json({ error: "listing_not_found_or_not_yours" }, { status: 403 });
  }

  // Gate 5 access (after ownership): the feature is invisible (404) to a non-allowlisted or
  // out-of-scope seller. An out-of-quota seller may still upload/replace source, so quota does
  // NOT block here (videoVisibilityDenial treats quota_exhausted as visible).
  const denial = videoVisibilityDenial(await deps.checkAccess({ userId: user.id, listingId }));
  if (denial) return NextResponse.json(denial.body, { status: denial.status });

  // Server owns the id + path — the client cannot choose either.
  const assetId = deps.generateAssetId();
  const storagePath = buildSourceStoragePath(user.id, listingId, assetId);

  const signed = await deps.createSignedUpload(SOURCE_BUCKET, storagePath);
  if ("error" in signed) return NextResponse.json({ error: "upload_init_failed" }, { status: 500 });

  return NextResponse.json(
    {
      assetId,
      bucket: SOURCE_BUCKET,
      storagePath,
      upload: { signedUrl: signed.signedUrl, token: signed.token },
    },
    { status: 200 },
  );
}

export async function POST(req: Request): Promise<Response> {
  if (!isCreativeStudioVideoEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return handleInitiateSourceUpload(req, defaultDeps());
}
