"use client";

// Cloudflare Turnstile widget for auth forms. Render it INSIDE the <form>:
// Turnstile injects a hidden input (TURNSTILE_RESPONSE_FIELD) holding the token,
// which the server action forwards to Supabase Auth as `captchaToken`
// (see src/lib/turnstile.ts). Renders nothing when no site key is configured,
// so local dev and CI keep working with CAPTCHA disabled in Supabase.
//
// Explicit rendering (not the `cf-turnstile` auto-scan) so it also mounts after
// client-side navigations and after a server action re-renders the page — each
// mount gets a fresh single-use token.

import { useEffect, useRef } from "react";
import { TURNSTILE_RESPONSE_FIELD, TURNSTILE_SITE_KEY } from "@/lib/turnstile";

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      "response-field-name": string;
      language?: string;
      theme?: "light" | "dark" | "auto";
      size?: "normal" | "flexible" | "compact";
    },
  ) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scriptPromise = null;
        reject(new Error("turnstile script failed to load"));
      };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

export function TurnstileWidget({ lang }: { lang: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !ref.current) return;
    let widgetId: string | null = null;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return;
        widgetId = window.turnstile.render(ref.current, {
          sitekey: TURNSTILE_SITE_KEY,
          "response-field-name": TURNSTILE_RESPONSE_FIELD,
          language: lang === "es" ? "es" : "en",
          theme: "light",
          size: "flexible",
        });
      })
      .catch(() => {
        // Script blocked/offline: the submit will fail Supabase's captcha check
        // and the page shows the captcha error — nothing else to do here.
      });
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [lang]);

  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={ref} className="min-h-[65px] w-full" />;
}
