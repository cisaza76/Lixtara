"use client";

import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { useEffect, useRef, useState } from "react";
import { Field } from "@/components/auth-shell";

interface Props {
  streetLabel: string;
  cityLabel: string;
  stateLabel: string;
  zipLabel: string;
  defaultStreet?: string;
  defaultCity?: string;
  defaultZip?: string;
  defaultLat?: number | null;
  defaultLng?: number | null;
  /** Visible note shown beneath the street input once a place is verified. */
  verifiedNote?: string;
}

interface AddressComponents {
  street: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
}

function extractComponents(
  place: google.maps.places.PlaceResult,
): AddressComponents {
  const get = (type: string, useShort = false) =>
    place.address_components?.find((c) => c.types.includes(type))?.[
      useShort ? "short_name" : "long_name"
    ] ?? "";

  const streetNumber = get("street_number");
  const route = get("route");
  const street = [streetNumber, route].filter(Boolean).join(" ").trim();
  const city = get("locality") || get("postal_town") || get("sublocality_level_1");
  const state = get("administrative_area_level_1", true);
  const zip = get("postal_code");

  return {
    street,
    city,
    state,
    zip,
    lat: place.geometry?.location?.lat() ?? null,
    lng: place.geometry?.location?.lng() ?? null,
  };
}

export function AddressAutocomplete({
  streetLabel,
  cityLabel,
  stateLabel,
  zipLabel,
  defaultStreet = "",
  defaultCity = "Miami",
  defaultZip = "",
  defaultLat = null,
  defaultLng = null,
  verifiedNote,
}: Props) {
  const streetInputRef = useRef<HTMLInputElement | null>(null);
  const cityInputRef = useRef<HTMLInputElement | null>(null);
  const zipInputRef = useRef<HTMLInputElement | null>(null);
  const latInputRef = useRef<HTMLInputElement | null>(null);
  const lngInputRef = useRef<HTMLInputElement | null>(null);
  const [verified, setVerified] = useState<boolean>(
    defaultLat !== null && defaultLng !== null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      setLoadError("Maps not configured.");
      return;
    }
    if (!streetInputRef.current) return;

    let autocomplete: google.maps.places.Autocomplete | null = null;
    setOptions({ key: apiKey, v: "weekly", libraries: ["places"] });

    (async () => {
      try {
        const places = await importLibrary("places");
        if (!streetInputRef.current) return;
        autocomplete = new places.Autocomplete(streetInputRef.current, {
          componentRestrictions: { country: "us" },
          fields: ["address_components", "geometry", "formatted_address"],
          types: ["address"],
        });
        autocomplete.addListener("place_changed", () => {
          if (!autocomplete) return;
          const place = autocomplete.getPlace();
          const c = extractComponents(place);
          if (streetInputRef.current && c.street) {
            streetInputRef.current.value = c.street;
          }
          if (cityInputRef.current && c.city) {
            cityInputRef.current.value = c.city;
          }
          if (zipInputRef.current && c.zip) {
            zipInputRef.current.value = c.zip;
          }
          if (latInputRef.current) {
            latInputRef.current.value = c.lat?.toString() ?? "";
          }
          if (lngInputRef.current) {
            lngInputRef.current.value = c.lng?.toString() ?? "";
          }
          setVerified(true);
        });
      } catch (err) {
        console.error("Google Maps load failed", err);
        setLoadError("Maps failed to load. Type the address manually.");
      }
    })();
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <input type="hidden" ref={latInputRef} name="lat" defaultValue={defaultLat ?? ""} />
      <input type="hidden" ref={lngInputRef} name="lng" defaultValue={defaultLng ?? ""} />

      <label className="flex flex-col gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
          {streetLabel}
        </span>
        <input
          ref={streetInputRef}
          name="street"
          type="text"
          required
          defaultValue={defaultStreet}
          autoComplete="off"
          className="bg-transparent border-b border-gold-soft focus:border-gold outline-none py-2 text-base text-ink"
        />
        {loadError ? (
          <span className="text-xs text-red-700">{loadError}</span>
        ) : verified && verifiedNote ? (
          <span className="text-xs text-gold">✓ {verifiedNote}</span>
        ) : null}
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <label className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
            {cityLabel}
          </span>
          <input
            ref={cityInputRef}
            name="city"
            type="text"
            required
            defaultValue={defaultCity}
            autoComplete="address-level2"
            className="bg-transparent border-b border-gold-soft focus:border-gold outline-none py-2 text-base text-ink"
          />
        </label>
        <div className="grid grid-cols-2 gap-6">
          <Field
            label={stateLabel}
            name="state"
            defaultValue="FL"
            autoComplete="address-level1"
          />
          <label className="flex flex-col gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
              {zipLabel}
            </span>
            <input
              ref={zipInputRef}
              name="zip"
              type="text"
              required
              defaultValue={defaultZip}
              autoComplete="postal-code"
              className="bg-transparent border-b border-gold-soft focus:border-gold outline-none py-2 text-base text-ink"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
