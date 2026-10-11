"use client";

// Banner de consentimiento de analítica + carga de las herramientas DESPUÉS de aceptar.
//
// - Sin elección guardada: banner con "Aceptar" y "Rechazar" del MISMO peso visual.
// - Aceptar: guarda la cookie `lx_consent=granted` y recién entonces carga GTM (con Consent
//   Mode v2: publicidad denegada, solo analytics_storage concedido) y PostHog.
// - Rechazar: `lx_consent=denied`. No se carga nada y track() no hace nada.
// - PostHog en modo estricto: sin autocapture (no lee textos, imágenes ni URLs de fichas
//   del MLS), sin grabación de sesión, pageviews manuales con la URL SIN parámetros.
//
// Solo se monta si hay al menos una herramienta configurada (ver analytics-config.ts); si
// no, el layout sigue mostrando el aviso informativo de siempre.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_S,
  readConsent,
  sanitizeUrl,
  type ConsentChoice,
} from "@/lib/analytics-config";
import { disableAnalytics, enableAnalytics } from "@/lib/analytics";

interface Props {
  lang: string;
  gtmId: string | null;
  posthogKey: string | null;
  posthogHost: string;
  labels: { message: string; learnMore: string; accept: string; reject: string; regionLabel: string };
}

type PostHogLike = { capture(e: string, p?: Record<string, unknown>): void; register(p: Record<string, unknown>): void };
let posthogInstance: PostHogLike | null = null;
let started = false;

function saveChoice(choice: ConsentChoice): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${choice}; Max-Age=${CONSENT_MAX_AGE_S}; Path=/; SameSite=Lax${secure}`;
}

function loadGtm(gtmId: string): void {
  const w = window as unknown as { dataLayer: unknown[] };
  w.dataLayer = w.dataLayer ?? [];
  // gtag() de Consent Mode v2: GTM espera el objeto `arguments`, no un arreglo.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function gtag(..._args: unknown[]) {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer.push(arguments);
  }
  gtag("consent", "default", {
    ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied",
  });
  gtag("consent", "update", { analytics_storage: "granted" });
  w.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtmId)}`;
  document.head.appendChild(s);
}

async function loadPosthog(key: string, host: string, lang: string): Promise<PostHogLike> {
  const { default: posthog } = await import("posthog-js");
  posthog.init(key, {
    api_host: host,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    disable_surveys: true,
    person_profiles: "identified_only",
    persistence: "localStorage+cookie",
    sanitize_properties: (props) => {
      for (const k of ["$current_url", "$referrer", "$initial_referrer", "$initial_current_url"]) {
        if (typeof props[k] === "string") props[k] = sanitizeUrl(props[k] as string) || props[k];
      }
      return props;
    },
  });
  posthog.register({ lang });
  return posthog as unknown as PostHogLike;
}

/**
 * Al rechazar o retirar el consentimiento: borra lo que las herramientas hubieran dejado
 * (cookies `_ga*` / `ph_*` y el almacenamiento local de PostHog).
 */
function clearAnalyticsStorage(): void {
  const host = window.location.hostname;
  const domains = ["", `; Domain=${host}`, `; Domain=.${host.replace(/^www\./, "")}`];
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (!name || !/^(_ga|_gid|ph_)/.test(name)) continue;
    for (const d of domains) document.cookie = `${name}=; Max-Age=0; Path=/${d}`;
  }
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("ph_")) localStorage.removeItem(k);
  } catch {
    /* almacenamiento bloqueado: nada que borrar */
  }
}

async function start(p: Pick<Props, "gtmId" | "posthogKey" | "posthogHost" | "lang">): Promise<void> {
  if (started) return;
  started = true;
  if (p.gtmId) loadGtm(p.gtmId);
  if (p.posthogKey) {
    try {
      posthogInstance = await loadPosthog(p.posthogKey, p.posthogHost, p.lang);
    } catch {
      posthogInstance = null; // PostHog caído: GA4 sigue; la página no se rompe.
    }
  }
  enableAnalytics(posthogInstance);
}

export function AnalyticsConsent(props: Props) {
  const [choice, setChoice] = useState<ConsentChoice | null | "unknown">("unknown");
  const pathname = usePathname();

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const c = readConsent(document.cookie);
      setChoice(c);
      if (c === "granted") void start(props);
      else {
        disableAnalytics();
        if (c === "denied") clearAnalyticsStorage();
      }
    });
    return () => cancelAnimationFrame(id);
    // Solo al montar: la configuración no cambia durante la vida de la página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pageview manual en PostHog con la URL sin parámetros. GA4 cuenta los suyos desde GTM.
  useEffect(() => {
    if (choice !== "granted" || !posthogInstance) return;
    posthogInstance.capture("$pageview", { $current_url: sanitizeUrl(window.location.href) });
  }, [pathname, choice]);

  if (choice !== null) return null;

  function decide(c: ConsentChoice) {
    saveChoice(c);
    setChoice(c);
    if (c === "granted") void start(props);
    else {
      disableAnalytics();
      clearAnalyticsStorage();
    }
  }

  const button =
    "shrink-0 inline-flex items-center justify-center px-5 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] transition-colors";
  return (
    <div
      role="region"
      aria-label={props.labels.regionLabel}
      className="fixed inset-x-0 bottom-0 z-[1000] border-t border-gold-soft bg-ink/95 backdrop-blur-sm px-4 py-3 sm:px-6"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-relaxed text-ivory/80">
          {props.labels.message}{" "}
          <Link href={`/${props.lang}/cookies`} className="text-gold underline underline-offset-2 hover:text-ivory">
            {props.labels.learnMore}
          </Link>
        </p>
        {/* Mismo peso visual para aceptar y rechazar: sin patrones oscuros. */}
        <div className="flex gap-2 self-start sm:self-auto">
          <button type="button" onClick={() => decide("denied")} className={`${button} border border-ivory/60 text-ivory hover:bg-ivory/10`}>
            {props.labels.reject}
          </button>
          <button type="button" onClick={() => decide("granted")} className={`${button} border border-gold bg-gold text-ink hover:bg-gold/90`}>
            {props.labels.accept}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Enlace del pie para cambiar la elección: borra la cookie y recarga. */
export function CookieSettingsLink({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`;
        window.location.reload();
      }}
      className="underline-offset-2 hover:underline"
    >
      {label}
    </button>
  );
}
