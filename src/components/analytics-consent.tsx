"use client";

// Banner de consentimiento de analítica + carga de las herramientas DESPUÉS de aceptar.
//
// - Sin elección guardada: banner con "Aceptar" y "Rechazar" del MISMO peso visual.
// - Aceptar: guarda la cookie `lx_consent=granted` y recién entonces carga GTM y PostHog.
//   Consent Mode v2: todo denegado por defecto ANTES de gtm.js y, en la misma carga, todo
//   concedido (analítica y publicidad), porque la persona ya aceptó. Opt-in en todas las
//   regiones (decisión del owner, 2026-10-13): no hay default por región ni carga previa.
//   Sin <noscript>: un iframe de GTM sin JavaScript se saltaría el consentimiento.
// - Rechazar: `lx_consent=denied`. No se carga nada y track() no hace nada.
// - PostHog en modo estricto: sin autocapture (no lee textos, imágenes ni URLs de fichas
//   del MLS), sin grabación de sesión, pageviews manuales con la URL SIN parámetros.
//
// Solo se monta si hay al menos una herramienta configurada (ver analytics-config.ts); si
// no, el layout sigue mostrando el aviso informativo de siempre.

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ANALYTICS_COOKIE_RE,
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_S,
  GRANTED_CONSENT,
  isAnalyticsExcludedPath,
  readConsent,
  sanitizePosthogProperties,
  sanitizeUrl,
  type ConsentChoice,
} from "@/lib/analytics-config";
import { disableAnalytics, enableAnalytics, markPageview } from "@/lib/analytics";

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
  // Solo se llega aquí con `lx_consent=granted`: el banner pide permiso para analítica Y
  // publicidad (Google Ads, Meta, Clarity vía GTM), y así lo dice la política de cookies.
  gtag("consent", "update", GRANTED_CONSENT);
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
    // Segunda barrera: ninguna captura automática, aunque se active desde el panel de PostHog.
    enable_heatmaps: false,
    capture_dead_clicks: false,
    rageclick: false,
    capture_performance: false,
    capture_exceptions: false,
    disable_web_experiments: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    sanitize_properties: (props) => sanitizePosthogProperties(props),
  });
  posthog.register({ lang });
  return posthog as unknown as PostHogLike;
}

/**
 * Al rechazar o retirar el consentimiento: borra lo que las herramientas hubieran dejado en
 * NUESTRO dominio (GA4 `_ga*`/`_gid`, Google Ads `_gcl_*`, Meta `_fbp`/`_fbc`, Clarity
 * `_clck`/`_clsk`, PostHog `ph_*` y su almacenamiento local). Las cookies que esos
 * proveedores guardan en sus propios dominios no son accesibles desde aquí.
 */
function clearAnalyticsStorage(): void {
  const host = window.location.hostname;
  const domains = ["", `; Domain=${host}`, `; Domain=.${host.replace(/^www\./, "")}`];
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (!name || !ANALYTICS_COOKIE_RE.test(name)) continue;
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

// La elección vive en la cookie; este pequeño "store" la lee sin esperar un frame de
// animación (que no corre en pestañas en segundo plano): el banner aparece igual en una
// pestaña visible que en una abierta en segundo plano.
const listeners = new Set<() => void>();
const consentStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: (): ConsentChoice | null => readConsent(document.cookie),
  server: (): "unknown" => "unknown",
};
function setConsent(choice: ConsentChoice): void {
  saveChoice(choice);
  for (const l of listeners) l();
}

let gtmLoaded = false;

export function AnalyticsConsent(props: Props) {
  const choice = useSyncExternalStore(consentStore.subscribe, consentStore.get, consentStore.server);
  const pathname = usePathname();
  const excluded = isAnalyticsExcludedPath(pathname);

  // Efectos de la elección: cargar (solo con "granted") o apagar y limpiar.
  useEffect(() => {
    if (choice === "unknown" || excluded) return;
    if (choice === "granted") {
      gtmLoaded = gtmLoaded || !!props.gtmId;
      void start(props).then(() => pageview());
    } else {
      disableAnalytics();
      if (choice === "denied") clearAnalyticsStorage();
    }
    // La configuración no cambia durante la vida de la página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice, excluded]);

  // Un pageview por cambio de ruta, con la URL SIN parámetros, para GA4 (evento propio en
  // el dataLayer; el Google tag NO envía su page_view automático, ver runbook) y PostHog.
  useEffect(() => {
    if (choice === "granted" && !excluded && started) pageview();
  }, [pathname, choice, excluded]);

  if (choice !== null || excluded) return null;

  // Mismo peso visual para aceptar y rechazar: mismo estilo, mismo tamaño. Sin patrones oscuros.
  const button =
    "shrink-0 inline-flex items-center justify-center px-5 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] transition-colors border border-gold text-ivory hover:bg-gold hover:text-ink";
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
        <div className="flex gap-2 self-start sm:self-auto">
          <button type="button" onClick={() => setConsent("denied")} className={button}>
            {props.labels.reject}
          </button>
          <button type="button" onClick={() => setConsent("granted")} className={button}>
            {props.labels.accept}
          </button>
        </div>
      </div>
    </div>
  );
}

// Un pageview por ruta y por herramienta (la carga de PostHog es asíncrona: llega después).
let lastGtmPath: string | null = null;
let lastPosthogPath: string | null = null;
function pageview(): void {
  const path = window.location.pathname;
  const page_location = sanitizeUrl(window.location.href);
  if (gtmLoaded && lastGtmPath !== path) {
    lastGtmPath = path;
    const w = window as unknown as { dataLayer: unknown[] };
    w.dataLayer = w.dataLayer ?? [];
    w.dataLayer.push({ event: "lx_page_view", page_location, page_path: path });
  }
  // Los eventos de la página que esperaban este page_view salen ahora, después de él.
  markPageview(path);
  if (posthogInstance && lastPosthogPath !== path) {
    lastPosthogPath = path;
    posthogInstance.capture("$pageview", { $current_url: page_location });
  }
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
