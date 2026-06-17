"use client";

import { useEffect, useRef, useState } from "react";
import { Field } from "@/components/auth-shell";

interface Props {
  streetLabel: string;
  unitLabel: string;
  cityLabel: string;
  stateLabel: string;
  zipLabel: string;
  defaultStreet?: string;
  defaultUnit?: string;
  defaultCity?: string;
  defaultZip?: string;
  defaultLat?: number | null;
  defaultLng?: number | null;
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

type Status = "idle" | "loading" | "ready" | "error";

declare global {
  interface Window {
    __lixtaraMapsCallbacks?: Array<() => void>;
    __lixtaraMapsInit?: () => void;
  }
}

const SCRIPT_ID = "lixtara-google-maps-script";

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
  const city =
    get("locality") || get("postal_town") || get("sublocality_level_1");
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

// Loads the Google Maps JS API with the Places library. We use the legacy
// script-tag + `&callback=` pattern (still supported, paired with
// `loading=async` for performance) instead of `importLibrary`. Reason: the
// script-tag URL ONLY exposes `google.maps.Load` / `google.maps.modules` —
// it does NOT define `google.maps.importLibrary`. That function is exclusive
// to Google's inline bootstrap loader. The previous code combined the two
// and produced "TypeError: window.google.maps.importLibrary is not a
// function" in production.
function loadGoogleMaps(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("not browser"));
      return;
    }
    // Places already loaded? Done.
    if (
      (window as { google?: { maps?: { places?: unknown } } }).google?.maps
        ?.places
    ) {
      resolve();
      return;
    }
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      // Another instance is loading — queue for when it finishes.
      window.__lixtaraMapsCallbacks = window.__lixtaraMapsCallbacks ?? [];
      window.__lixtaraMapsCallbacks.push(resolve);
      return;
    }
    // Google invokes this once Maps + Places are attached to the global.
    window.__lixtaraMapsInit = () => {
      resolve();
      for (const cb of window.__lixtaraMapsCallbacks ?? []) cb();
      window.__lixtaraMapsCallbacks = [];
    };
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}` +
      `&libraries=places&v=weekly&loading=async&callback=__lixtaraMapsInit`;
    script.async = true;
    script.defer = true;
    script.onerror = () =>
      reject(new Error("Failed to load Google Maps script"));
    document.head.appendChild(script);
  });
}

export function AddressAutocomplete({
  streetLabel,
  unitLabel,
  cityLabel,
  stateLabel,
  zipLabel,
  defaultStreet = "",
  defaultUnit = "",
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
  // Inlined at build time, so the missing-key state is known at render — derive
  // it via lazy initializers instead of setState-in-effect.
  const mapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  // Effect runs once on mount and immediately loads Maps, so start in "loading"
  // when the key is present — equivalent to the old setStatus("loading"), minus
  // the synchronous setState-in-effect.
  const [status, setStatus] = useState<Status>(() =>
    mapsApiKey ? "loading" : "error",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    mapsApiKey ? null : "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY missing.",
  );
  const [verified, setVerified] = useState<boolean>(
    defaultLat !== null && defaultLng !== null,
  );

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    // Missing-key error is already reflected in initial state above; "loading"
    // is the initial status when the key is present.
    if (!apiKey) return;

    let autocomplete: google.maps.places.Autocomplete | null = null;

    loadGoogleMaps(apiKey)
      .then(() => {
        if (!streetInputRef.current) {
          setStatus("error");
          setErrorMessage("Street input ref lost.");
          return;
        }
        // `callback=__lixtaraMapsInit` only fires after Maps + Places are
        // both attached; window.google.maps.places.Autocomplete is ready.
        const places = window.google?.maps?.places;
        if (!places?.Autocomplete) {
          setStatus("error");
          setErrorMessage(
            "Places library failed to load — check that Places API is enabled and your domain is allowlisted on the Google Maps key.",
          );
          return;
        }
        try {
          autocomplete = new places.Autocomplete(
            streetInputRef.current,
            {
              componentRestrictions: { country: "us" },
              fields: [
                "address_components",
                "geometry",
                "formatted_address",
              ],
              types: ["address"],
            },
          );
        } catch (initErr) {
          console.error("[AddressAutocomplete] init failed", initErr);
          setStatus("error");
          setErrorMessage(
            "Places Autocomplete init threw — likely Places API not enabled or HTTP referrer not allowlisted.",
          );
          return;
        }

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

        setStatus("ready");
      })
      .catch((err: Error) => {
        console.error("[AddressAutocomplete] load failed", err);
        setStatus("error");
        setErrorMessage(err.message);
      });
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <input
        type="hidden"
        ref={latInputRef}
        name="lat"
        defaultValue={defaultLat ?? ""}
      />
      <input
        type="hidden"
        ref={lngInputRef}
        name="lng"
        defaultValue={defaultLng ?? ""}
      />

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
          autoComplete="address-line1"
          placeholder="Start typing — pick from Google's suggestions"
          className="bg-transparent border-b border-gold-soft focus:border-gold outline-none py-2 text-base text-ink"
        />
        <span
          className={`text-[10px] uppercase tracking-[0.18em] ${
            status === "error"
              ? "text-red-700"
              : status === "ready"
                ? verified
                  ? "text-gold"
                  : "text-ink/55"
                : "text-ink/40"
          }`}
        >
          {status === "loading" && "Maps: loading…"}
          {status === "ready" && !verified && "Maps: ready — start typing"}
          {status === "ready" && verified && `✓ ${verifiedNote ?? "Verified"}`}
          {status === "error" && `Maps error — type manually. (${errorMessage})`}
        </span>
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <label className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
            {unitLabel}
          </span>
          <input
            name="unit"
            type="text"
            defaultValue={defaultUnit}
            autoComplete="address-line2"
            placeholder="4502"
            className="bg-transparent border-b border-gold-soft focus:border-gold outline-none py-2 text-base text-ink"
          />
        </label>
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
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
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
  );
}
