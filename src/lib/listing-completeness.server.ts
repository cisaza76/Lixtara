import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchBuyerComp } from "@/lib/buyer-comp.server";
import { hasPaidPhotography } from "@/lib/listing-photos.server";
import { firstIncompleteStep, type ListingCompletenessFacts } from "@/lib/listing-completeness";
import { ownershipStepComplete, type StoredOwnership, type StoredSigner } from "@/lib/listing-ownership";

const FACT_COLUMNS =
  "address_street,address_city,address_zip,pricing_tier,property_type,bedrooms,bathrooms,sqft,year_built,list_price,financing_terms,occupancy_status,description,photos_rights_confirmed";

/**
 * Primer paso incompleto (1–6) del listing, o null si está completo. Lee con el cliente que
 * recibe (la sesión del vendedor: RLS). Si alguna lectura falla, lanza: quien llama decide
 * (la página deja pasar; la creación del acuerdo se niega).
 */
export async function loadFirstIncompleteStep(db: SupabaseClient, propertyId: string): Promise<number | null> {
  const [{ data: prop, error }, { count, error: photoError }, photographyPaid, buyerComp, ownership] = await Promise.all([
    db.from("properties").select(FACT_COLUMNS).eq("id", propertyId).maybeSingle(),
    db.from("property_photos").select("id", { count: "exact", head: true }).eq("property_id", propertyId),
    hasPaidPhotography(db, propertyId),
    fetchBuyerComp(db, propertyId),
    loadOwnership(db, propertyId),
  ]);
  if (error) throw new Error(`listing completeness: ${error.message}`);
  if (photoError) throw new Error(`listing completeness photos: ${photoError.message}`);
  if (!prop) return 1;
  return firstIncompleteStep({
    ...(prop as Omit<ListingCompletenessFacts, "photoCount" | "photographyPaid" | "buyerComp" | "ownershipComplete">),
    photoCount: count ?? 0,
    photographyPaid,
    buyerComp,
    ownershipComplete: ownershipStepComplete(ownership.ownership, ownership.signers),
  });
}

/** Titular y firmantes guardados (#220). Si la lectura falla, lanza (como las demás). */
export async function loadOwnership(
  db: SupabaseClient,
  propertyId: string,
): Promise<{ ownership: StoredOwnership | null; signers: StoredSigner[] }> {
  const [{ data: ownership, error }, { data: signers, error: signersError }] = await Promise.all([
    db
      .from("listing_ownership")
      .select("owner_kind,other_title_holders,married_homestead,manual_review_reason,manual_review_cleared_at")
      .eq("property_id", propertyId)
      .maybeSingle(),
    db.from("listing_additional_signers").select("full_name,email,relationship").eq("property_id", propertyId),
  ]);
  if (error) throw new Error(`listing ownership: ${error.message}`);
  if (signersError) throw new Error(`listing signers: ${signersError.message}`);
  return { ownership: (ownership ?? null) as StoredOwnership | null, signers: (signers ?? []) as StoredSigner[] };
}
