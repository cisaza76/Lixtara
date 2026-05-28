// Server-side address validation + geocoding against the Google Geocoding API.
//
// Primary path: AddressAutocomplete (client) sets lat/lng when the user picks
// a Google Places suggestion. This server function is BOTH a second-pass
// validation AND a fallback geocoder for cases where the client autocomplete
// failed (Maps script blocked, async timing, etc.) — it returns lat/lng so
// the caller can save them even when the form arrived without coords.
//
// Fail policy:
//   - Hard fail (ok:false) only when Google says the address definitively
//     doesn't exist OR the state/zip clearly don't match what was typed.
//   - Fail open (ok:true, lat/lng undefined) on key issues, network errors,
//     REQUEST_DENIED, OVER_QUERY_LIMIT — never block a legitimate listing
//     on Google's quota or our key config.

export interface AddressCheck {
  ok: boolean;
  reason?: "not_found" | "zip_mismatch" | "state_mismatch";
  lat?: number;
  lng?: number;
}

export async function validateUsAddress(
  street: string,
  city: string,
  state: string,
  zip: string,
): Promise<AddressCheck> {
  // Server-only key for Geocoding API: the public Maps JS key is restricted
  // by HTTP referrer, which Google rejects on server calls with REQUEST_DENIED.
  // Fall back to the public key for local dev so devs without the server key
  // provisioned still get a (fail-open) response instead of a hard error.
  const key =
    process.env.GOOGLE_GEOCODING_API_KEY ??
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return { ok: true }; // can't validate → don't block

  const address = `${street}, ${city}, ${state} ${zip}`;
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}` +
    `&components=country:US&key=${key}`;

  let data: {
    status?: string;
    results?: Array<{
      geometry?: {
        location_type?: string;
        location?: { lat?: number; lng?: number };
      };
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
  if (data.status !== "OK" || !data.results?.length) {
    // Surface mis-configured keys loudly — fail-open masked a referrer-
    // restricted key being used server-side for months.
    if (data.status && data.status !== "OK") {
      console.warn(
        `[geocode] Google Geocoding API returned status=${data.status}` +
          " — falling open. Check GOOGLE_GEOCODING_API_KEY restrictions.",
      );
    }
    return { ok: true };
  }

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
  const lat = result.geometry?.location?.lat;
  const lng = result.geometry?.location?.lng;
  return {
    ok: true,
    ...(typeof lat === "number" && typeof lng === "number" ? { lat, lng } : {}),
  };
}
