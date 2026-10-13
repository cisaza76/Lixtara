"use client";

// App Router global error boundary (P1 pre-Gate-5): reports render-tree crashes that would
// otherwise be invisible, then shows a minimal, brand-neutral recovery screen. Next.js
// requires this component to render its own <html>/<body>. Kept intentionally static (no
// i18n dictionaries — the error may have originated in them). The language is read from
// the URL's first segment (/en or /es), so the copy below is inline and bilingual.
import * as Sentry from "@sentry/nextjs";
import { useEffect, useSyncExternalStore } from "react";

const COPY = {
  en: {
    title: "Something went wrong",
    body: "The error has been reported. Please try again.",
    retry: "Try again",
  },
  es: {
    title: "Algo salió mal",
    body: "Ya reportamos el error. Inténtalo de nuevo.",
    retry: "Intentar de nuevo",
  },
} as const;

type ErrorLang = keyof typeof COPY;

function readLangFromPath(): ErrorLang {
  return window.location.pathname.split("/")[1] === "es" ? "es" : "en";
}

function noopSubscribe() {
  return () => {};
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  const lang = useSyncExternalStore<ErrorLang>(noopSubscribe, readLangFromPath, () => "en");
  const copy = COPY[lang];

  return (
    <html lang={lang}>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#FBFAF6",
          color: "#1A1A1A",
          fontFamily: "Georgia, 'Times New Roman', serif",
          textAlign: "center",
          padding: "2rem",
        }}
      >
        <div>
          <p style={{ letterSpacing: "0.2em", fontSize: 12, textTransform: "uppercase", color: "#B08D57" }}>
            Lixtara
          </p>
          <h1 style={{ fontWeight: 400, fontSize: 28, margin: "0.5rem 0 1rem" }}>
            {copy.title}
          </h1>
          <p style={{ fontSize: 14, opacity: 0.7, marginBottom: "1.5rem" }}>
            {copy.body}
          </p>
          <button
            onClick={() => reset()}
            style={{
              background: "#1A1A1A",
              color: "#FBFAF6",
              border: 0,
              padding: "0.9rem 2rem",
              fontSize: 12,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {copy.retry}
          </button>
        </div>
      </body>
    </html>
  );
}
