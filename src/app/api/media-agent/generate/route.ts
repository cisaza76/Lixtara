// POST /api/media-agent/generate — body: { property_id }
//
// Flow: flag gate → auth → rate-limit → validate → ownership → create job →
// run pipeline synchronously (mock render) → persist → return payload.
// v1 produces NO real media; every deliverable is mock.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { apiLimiter, enforceLimit } from "@/lib/ratelimit";
import { runMediaAgent, type AgentDeps } from "@/lib/media-intelligence/agent";
import { createJob, completeJob, failJob } from "@/lib/media-intelligence/jobs";
import { setJobStatus } from "@/lib/media-intelligence/jobs";
import { SelectionEmptyError } from "@/lib/media-intelligence/select";
import { toAssets } from "@/lib/media-intelligence/ingest";
import { classifyAssets } from "@/lib/media-intelligence/classify";
import { scoreAssets } from "@/lib/media-intelligence/quality";
import { buildStrategy } from "@/lib/media-intelligence/strategy";
import type { ListingFacts } from "@/lib/media-intelligence/strategy";

export const maxDuration = 300;

export function isMediaAgentEnabled(): boolean {
  return process.env.MEDIA_AGENT_ENABLED === "true";
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("supabase service credentials not configured");
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

interface Body {
  property_id?: string;
}

export async function POST(req: Request) {
  if (!isMediaAgentEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const limited = await enforceLimit(
    apiLimiter("media-agent:generate", 3, "1 h"),
    `u:${user.id}`,
    { label: "media-agent:generate", message: "Too many requests. Please wait." },
  );
  if (limited) return limited;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const propertyId = body.property_id;
  if (!propertyId) {
    return NextResponse.json({ error: "property_id_required" }, { status: 400 });
  }

  // Ownership via RLS: the user can only read their own property + its photos.
  const { data: property } = await supabase
    .from("properties")
    .select("id, list_price, bedrooms, bathrooms, address_city")
    .eq("id", propertyId)
    .maybeSingle();
  if (!property) {
    return NextResponse.json({ error: "property_not_found_or_not_yours" }, { status: 403 });
  }

  const { data: photoRows } = await supabase
    .from("property_photos")
    .select("id, url")
    .eq("property_id", propertyId)
    .eq("is_staged", false)
    .order("display_order", { ascending: true });

  let assets;
  try {
    assets = toAssets(photoRows ?? []);
  } catch {
    return NextResponse.json({ error: "too_few_photos", min: 3 }, { status: 422 });
  }

  const svc = serviceClient();
  const jobId = await createJob(svc as never, { propertyId, ownerId: user.id });

  const deps: AgentDeps = {
    loadAssets: async () => assets,
    classify: (a) => classifyAssets(a),
    score: (a) => scoreAssets(a),
    strategy: (shots, classifications, facts) => buildStrategy(shots, classifications, facts),
    listingFacts: async (): Promise<ListingFacts> => ({
      price: Number(property.list_price ?? 0),
      beds: Number(property.bedrooms ?? 0),
      baths: Number(property.bathrooms ?? 0),
      city: String(property.address_city ?? ""),
    }),
    setStatus: (id, status) => setJobStatus(svc as never, id, status),
  };

  try {
    const payload = await runMediaAgent({ jobId, propertyId, ownerId: user.id }, deps);
    const providers = Object.values(payload.providersUsed).join(",") || "mock";
    await completeJob(svc as never, jobId, payload, providers);
    return NextResponse.json({ jobId, status: "completed", strategy: payload });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "pipeline_error";
    console.error(`[media-agent] job=${jobId} failed: ${msg}`);
    try {
      await failJob(svc as never, jobId, msg);
    } catch (persistErr) {
      console.error("[media-agent] failJob also failed", persistErr);
    }
    if (e instanceof SelectionEmptyError) {
      return NextResponse.json({ error: "no_usable_photos" }, { status: 422 });
    }
    return NextResponse.json({ error: "pipeline_failed", detail: msg, jobId }, { status: 500 });
  }
}
