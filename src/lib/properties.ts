import { createClient } from "@/lib/supabase/server";

export interface PropertySummary {
  id: string;
  address_street: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  list_price: number;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  property_type: string;
  primary_photo_url: string | null;
}

export interface PropertyDetail extends PropertySummary {
  latitude: number | null;
  longitude: number | null;
  year_built: number;
  description: string | null;
  buyer_agent_commission: number;
  photos: {
    url: string;
    is_primary: boolean;
    display_order: number;
    is_staged?: boolean;
  }[];
}

export async function getActiveProperties(): Promise<PropertySummary[]> {
  // Uses the publishable-key SSR client now that the RLS recursion is fixed
  // (migration supabase/migrations/20260517_fix_rls_recursion.sql). The
  // service-role client in src/lib/supabase/service.ts is reserved for admin
  // operations that legitimately need to bypass RLS.
  const supabase = await createClient();
  const { data: props } = await supabase
    .from("properties")
    .select(
      "id,address_street,address_city,address_state,address_zip,list_price,bedrooms,bathrooms,sqft,property_type,created_at",
    )
    .eq("mls_status", "active")
    .order("created_at", { ascending: false });

  const ids = (props ?? []).map((p) => p.id);
  const photoMap = new Map<string, string>();
  if (ids.length > 0) {
    const { data: photos } = await supabase
      .from("property_photos")
      .select("property_id,url,is_primary,display_order")
      .in("property_id", ids)
      .order("display_order", { ascending: true });
    for (const ph of photos ?? []) {
      if (!photoMap.has(ph.property_id)) photoMap.set(ph.property_id, ph.url);
      if (ph.is_primary) photoMap.set(ph.property_id, ph.url);
    }
  }

  return (props ?? []).map((p) => ({
    ...p,
    primary_photo_url: photoMap.get(p.id) ?? null,
  })) as PropertySummary[];
}

export async function getPropertyById(
  id: string,
): Promise<PropertyDetail | null> {
  const supabase = await createClient();
  const { data: prop } = await supabase
    .from("properties")
    .select(
      "id,address_street,address_city,address_state,address_zip,list_price,bedrooms,bathrooms,sqft,property_type,latitude,longitude,year_built,description,buyer_agent_commission,mls_status",
    )
    .eq("id", id)
    .eq("mls_status", "active")
    .maybeSingle();

  if (!prop) return null;

  const { data: photos } = await supabase
    .from("property_photos")
    .select("url,is_primary,display_order,is_staged")
    .eq("property_id", id)
    .order("display_order", { ascending: true });

  const primary = photos?.find((p) => p.is_primary)?.url ?? photos?.[0]?.url ?? null;

  return {
    ...prop,
    photos: photos ?? [],
    primary_photo_url: primary,
  } as PropertyDetail;
}

export function formatPropertyPrice(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function mapboxStaticUrl(
  lat: number,
  lng: number,
  width: number,
  height: number,
): string {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return "";
  // Gold pin (#B49157) matches brand. Light style for editorial feel.
  return `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/pin-l+B49157(${lng},${lat})/${lng},${lat},14/${width}x${height}@2x?access_token=${token}`;
}

export function isDemoListing(addressStreet: string): boolean {
  return addressStreet.startsWith("[DEMO]");
}

export function cleanDemoPrefix(addressStreet: string): string {
  return addressStreet.replace(/^\[DEMO\]\s*/, "");
}
