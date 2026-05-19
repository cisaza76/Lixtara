// POST   /api/saves  — body { property_id } — insert (idempotent via unique)
// DELETE /api/saves  — body { property_id } — remove

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface Body {
  property_id?: string;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.property_id) {
    return NextResponse.json({ error: "property_id_required" }, { status: 400 });
  }

  // Idempotent — unique (user_id, property_id) makes re-saves a no-op.
  const { error } = await supabase
    .from("saved_properties")
    .insert({ user_id: user.id, property_id: body.property_id });
  if (error && !error.message.includes("duplicate")) {
    return NextResponse.json({ error: "save_failed", detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ saved: true });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.property_id) {
    return NextResponse.json({ error: "property_id_required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("saved_properties")
    .delete()
    .eq("user_id", user.id)
    .eq("property_id", body.property_id);
  if (error) {
    return NextResponse.json({ error: "unsave_failed", detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ saved: false });
}
