"use client";

// Banner de consentimiento por categoría + carga de las herramientas DESPUÉS de aceptar.
//
// - Dos categorías con el mismo peso visual: Analítica (GA4 y Clarity vía GTM, PostHog) y
//   Publicidad (Meta y Google Ads vía GTM; decisión del owner 2026-10-24). Cada una con
//   "Aceptar" y "Rechazar"; "Rechazar todo" y "Aceptar todo" igual de visibles. Todo denegado
//   por defecto: "Guardar" sin tocar nada = rechazar todo.
// - La elección se guarda en `lx_consent` (consentCookieValue) y se reaplica en cada carga
//   ANTES de gtm.js: Consent Mode v2 todo denegado por defecto y, en la misma carga, la
//   actualización de la elección (consentModeUpdate). En las rutas sin publicidad
//   (isAdsExcludedPath) las tres señales de publicidad quedan denegadas aunque se haya
//   aceptado, y el dataLayer lleva `lx_ads_consent` para que GTM no dispare Meta ni Ads.
//   Sin <noscript>: un iframe de GTM sin JavaScript se saltaría el consentimiento.
// - GTM se carga si hay al menos una categoría aceptada. PostHog y los eventos propios
//   (track(), lx_page_view) solo con Analítica aceptada.
// - Rechazar una categoría borra las cookies que esa categoría dejó en nuestro dominio.
// - Global Privacy Control (2026-10-24): con `navigator.globalPrivacyControl === true`, la
//   Publicidad queda denegada (no se puede aceptar y el aviso lo dice en esa categoría) y sus
//   cookies se borran. La Analítica no cambia.
// - PostHog en modo estricto: sin autocapture (no lee textos, imágenes ni URLs de fichas
//   del MLS), sin grabación de sesión, pageviews manuales con la URL SIN parámetros.
//
// Solo se monta si hay al menos una herramienta configurada (ver analytics-config.ts); si
// no, el layout sigue mostrando el aviso informativo de siempre.

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ADS_COOKIE_RE,
  ANALYTICS_COOKIE_RE,
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_S,
  consentCookieValue,
  consentModeUpdate,
  effectiveConsent,
  gpcEnabled,
  isAnalyticsExcludedPath,
  readConsentState,
  sanitizePosthogProperties,
  sanitizeUrl,
  type ConsentChoice,
  type ConsentState,
} from "@/lib/analytics-config";
import { disableAnalytics, enableAnalytics, markPageview } from "@/lib/analytics";
import { campaignFields } from "@/lib/funnel-events";

interface Props {
  lang: string;
  gtmId: string | null;
  posthogKey: string | null;
  posthogHost: string;
  labels: {
    message: string;
    learnMore: string;
    accept: string;
    reject: string;
    acceptAll: string;
    rejectAll: string;
    save: string;
    analytics: string;
    /** null: sin GTM no hay publicidad que pedir (Meta y Google Ads solo vía GTM). */
    ads: string | null;
    /** Nota de la categoría Publicidad cuando el navegador manda Global Privacy Control. */
    gpcNote: string;
    regionLabel: string;
  };
}

type PostHogLike = { capture(e: string, p?: Record<string, unknown>): void; register(p: Record<string, unknown>): void };
let posthogInstance: PostHogLike | null = null;
let started = false;

function saveChoice(choice: ConsentState): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${consentCookieValue(choice)}; Max-Age=${CONSENT_MAX_AGE_S}; Path=/; SameSite=Lax${secure}`;
}

function loadGtm(gtmId: string, choice: ConsentState): void {
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
  // La elección guardada, por categoría; en las rutas sin publicidad, publicidad denegada.
  const update = consentModeUpdate(choice, window.location.pathname, gpcEnabled(navigator));
  gtag("consent", "update", update);
  // Para las etiquetas que no leen Consent Mode (el píxel de Meta): GTM las dispara solo con
  // lx_ads_consent = "granted"; GA4 y Clarity, solo con lx_analytics_consent = "granted".
  w.dataLayer.push({
    event: "lx_consent",
    lx_analytics_consent: update.analytics_storage,
    lx_ads_consent: update.ad_storage,
  });
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
 * Al rechazar o retirar una categoría: borra lo que sus herramientas hubieran dejado en
 * NUESTRO dominio. Analítica: GA4 `_ga*`/`_gid`, Clarity `_clck`/`_clsk`, PostHog `ph_*` y su
 * almacenamiento local. Publicidad: Google Ads `_gcl_*`, Meta `_fbp`/`_fbc`. Las cookies que
 * esos proveedores guardan en sus propios dominios no son accesibles desde aquí.
 */
function clearStorage(re: RegExp, alsoPosthog: boolean): void {
  const host = window.location.hostname;
  const domains = ["", `; Domain=${host}`, `; Domain=.${host.replace(/^www\./, "")}`];
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (!name || !re.test(name)) continue;
    for (const d of domains) document.cookie = `${name}=; Max-Age=0; Path=/${d}`;
  }
  if (!alsoPosthog) return;
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("ph_")) localStorage.removeItem(k);
  } catch {
    /* almacenamiento bloqueado: nada que borrar */
  }
}

async function start(
  p: Pick<Props, "gtmId" | "posthogKey" | "posthogHost" | "lang">,
  choice: ConsentState,
): Promise<void> {
  if (started) return;
  started = true;
  if (p.gtmId) {
    loadGtm(p.gtmId, choice);
    gtmLoaded = true;
  }
  // PostHog y los eventos propios: solo con analítica (la publicidad sola no los habilita).
  if (choice.analytics !== "granted") return;
  analyticsOn = true;
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
  // Un string (no un objeto) para que useSyncExternalStore compare por valor.
  get: (): string | null => {
    const s = readConsentState(document.cookie);
    return s ? consentCookieValue(s) : null;
  },
  server: (): "unknown" => "unknown",
};
function setConsent(choice: ConsentState): void {
  saveChoice(choice);
  for (const l of listeners) l();
}

let gtmLoaded = false;
let analyticsOn = false;
const noSubscribe = () => () => {};

export function AnalyticsConsent(props: Props) {
  const raw = useSyncExternalStore(consentStore.subscribe, consentStore.get, consentStore.server);
  const choice = raw === "unknown" || raw === null ? raw : readConsentState(`${CONSENT_COOKIE}=${raw}`);
  const analytics = choice && choice !== "unknown" ? choice.analytics : null;
  const ads = choice && choice !== "unknown" ? choice.ads : null;
  const pathname = usePathname();
  const excluded = isAnalyticsExcludedPath(pathname);
  // Lo que se marca en el banner antes de guardar. Por defecto, todo rechazado.
  const [draft, setDraft] = useState<ConsentState>({ analytics: "denied", ads: "denied" });
  // Global Privacy Control: solo existe en el navegador, así que se lee después de montar.
  const gpc = useSyncExternalStore(noSubscribe, () => gpcEnabled(navigator), () => false);

  // Efectos de la elección: cargar lo aceptado; apagar y limpiar lo rechazado.
  useEffect(() => {
    if (analytics === null || ads === null || excluded) return;
    const state = effectiveConsent({ analytics, ads: props.gtmId ? ads : "denied" }, gpc);
    if (state.analytics === "granted" || state.ads === "granted") {
      void start(props, state).then(() => pageview());
    }
    if (state.analytics === "denied") {
      disableAnalytics();
      clearStorage(ANALYTICS_COOKIE_RE, true);
    }
    if (state.ads === "denied") clearStorage(ADS_COOKIE_RE, false);
    // La configuración no cambia durante la vida de la página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analytics, ads, excluded, gpc]);

  // Un pageview por cambio de ruta, con la URL SIN parámetros, para GA4 (evento propio en
  // el dataLayer; el Google tag NO envía su page_view automático, ver runbook) y PostHog.
  useEffect(() => {
    if (analytics === "granted" && !excluded && started) pageview();
  }, [pathname, analytics, excluded]);

  if (choice !== null || excluded) return null;

  // Con GPC, "Aceptar todo" y "Guardar" nunca guardan la publicidad aceptada.
  const all = (c: ConsentChoice): ConsentState => effectiveConsent({ analytics: c, ads: props.labels.ads ? c : "denied" }, gpc);
  // Mismo peso visual para aceptar y rechazar, para cada categoría y para "todo": mismo
  // estilo, mismo tamaño. Sin patrones oscuros.
  const button =
    "shrink-0 inline-flex items-center justify-center px-5 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] transition-colors border border-gold text-ivory hover:bg-gold hover:text-ink";
  const option = (on: boolean) =>
    `inline-flex items-center justify-center px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] transition-colors border border-gold ${
      on ? "bg-gold text-ink" : "text-ivory hover:bg-gold/20"
    }`;
  const categories = [
    { key: "analytics" as const, label: props.labels.analytics },
    ...(props.labels.ads ? [{ key: "ads" as const, label: props.labels.ads }] : []),
  ];
  return (
    <div
      role="region"
      aria-label={props.labels.regionLabel}
      className="fixed inset-x-0 bottom-0 z-[1000] border-t border-gold-soft bg-ink/95 backdrop-blur-sm px-4 py-3 sm:px-6"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
        <p className="text-xs leading-relaxed text-ivory/80">
          {props.labels.message}{" "}
          <Link href={`/${props.lang}/cookies`} className="text-gold underline underline-offset-2 hover:text-ivory">
            {props.labels.learnMore}
          </Link>
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {categories.map((c) => {
              const blocked = c.key === "ads" && gpc;
              return (
              <div key={c.key} role="group" aria-label={c.label} className="flex flex-wrap items-center gap-2">
                <span className="min-w-[5.5rem] text-[11px] font-semibold uppercase tracking-[0.14em] text-ivory">
                  {c.label}
                </span>
                <button
                  type="button"
                  aria-pressed={draft[c.key] === "denied"}
                  onClick={() => setDraft({ ...draft, [c.key]: "denied" })}
                  className={option(draft[c.key] === "denied")}
                >
                  {props.labels.reject}
                </button>
                <button
                  type="button"
                  aria-pressed={draft[c.key] === "granted"}
                  disabled={blocked}
                  onClick={() => setDraft({ ...draft, [c.key]: "granted" })}
                  className={`${option(draft[c.key] === "granted")} disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  {props.labels.accept}
                </button>
                {blocked && <span className="basis-full text-[11px] text-ivory/70">{props.labels.gpcNote}</span>}
              </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2 sm:flex-nowrap">
            <button type="button" onClick={() => setConsent(all("denied"))} className={button}>
              {props.labels.rejectAll}
            </button>
            <button type="button" onClick={() => setConsent(effectiveConsent(draft, gpc))} className={button}>
              {props.labels.save}
            </button>
            <button type="button" onClick={() => setConsent(all("granted"))} className={button}>
              {props.labels.acceptAll}
            </button>
          </div>
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
  const campaign = campaignFields(new URLSearchParams(window.location.search));
  if (gtmLoaded && analyticsOn && lastGtmPath !== path) {
    lastGtmPath = path;
    const w = window as unknown as { dataLayer: unknown[] };
    w.dataLayer = w.dataLayer ?? [];
    // UTM (p. ej. los correos de Instantly) como campos de campaña: la URL va sin parámetros.
    w.dataLayer.push({ event: "lx_page_view", page_location, page_path: path, ...campaign });
  }
  // Los eventos de la página que esperaban este page_view salen ahora, después de él.
  markPageview(path);
  if (posthogInstance && lastPosthogPath !== path) {
    lastPosthogPath = path;
    posthogInstance.capture("$pageview", {
      $current_url: page_location,
      ...(campaign.campaign_source ? { utm_source: campaign.campaign_source } : {}),
      ...(campaign.campaign_medium ? { utm_medium: campaign.campaign_medium } : {}),
      ...(campaign.campaign_name ? { utm_campaign: campaign.campaign_name } : {}),
    });
  }
}

/**
 * Enlace del pie para cambiar o retirar la elección: borra la cookie y recarga. Al recargar,
 * nada se carga (todo denegado) hasta que se vuelva a elegir en el banner.
 */
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
