"use client";

// App Router global error boundary (P1 pre-Gate-5): reports render-tree crashes that would
// otherwise be invisible, then shows a minimal, brand-neutral recovery screen. Next.js
// requires this component to render its own <html>/<body>. Kept intentionally static (no
// i18n dictionaries — the error may have originated in them).
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

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

  return (
    <html lang="en">
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
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, opacity: 0.7, marginBottom: "1.5rem" }}>
            The error has been reported. Please try again.
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
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
