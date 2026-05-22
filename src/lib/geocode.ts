// Server-side address validation against the Google Geocoding API.
//
// The primary guarantee comes from the client: AddressAutocomplete only sets
// lat/lng when the user picks a real Google Places suggestion (which also fills
// city/zip from Google). This server check is a best-effort second pass that
// FAILS OPEN — if the key is referrer-restricted, missing, or the API errors,
// it returns ok:true so we never block a legitimate listing on key config.
// It only returns ok:false when Google definitively says the address doesn't
// exist or the ZIP/state clearly don't match.

export interface AddressCheck {
  ok: boolean;
  reason?: "not_found" | "zip_mismatch" | "state_mismatch";
}

export async function validateUsAddress(
  street: string,
  city: string,
  state: string,
  zip: string,
): Promise<AddressCheck> {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return { ok: true }; // can't validate → don't block

  const address = `${street}, ${city}, ${state} ${zip}`;
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}` +
    `&components=country:US&key=${key}`;

  let data: {
    status?: string;
    results?: Array<{
      geometry?: { location_type?: string };
      address_components?: Array<{
        short_name: string;
        long_name: string;
        types: string[];
      }>;
    }>;
  };
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: true };
    data = await res.json();
  } catch {
    return { ok: true };
  }

  // REQUEST_DENIED / OVER_QUERY_LIMIT / etc. → fail open.
  if (data.status === "ZERO_RESULTS") return { ok: false, reason: "not_found" };
  if (data.status !== "OK" || !data.results?.length) return { ok: true };

  const result = data.results[0]!;
  // APPROXIMATE means the geocoder couldn't pin a real street address.
  const lt = result.geometry?.location_type;
  if (lt === "APPROXIMATE") return { ok: false, reason: "not_found" };

  const comp = (type: string) =>
    result.address_components?.find((c) => c.types.includes(type));
  const resState = comp("administrative_area_level_1")?.short_name;
  const resZip = comp("postal_code")?.long_name;

  if (resState && resState.toUpperCase() !== state.toUpperCase()) {
    return { ok: false, reason: "state_mismatch" };
  }
  if (resZip && zip && resZip.slice(0, 5) !== zip.slice(0, 5)) {
    return { ok: false, reason: "zip_mismatch" };
  }
  return { ok: true };
}
