"use client";

import { useEffect, useRef, useState } from "react";

interface TourViewerProps {
  /** Signed Supabase Storage URL pointing at the KIRI .zip (contains a .ply 3DGS scene). */
  zipUrl: string;
  /** Optional cover image shown until the splat loads. */
  posterUrl?: string;
  labels: {
    loading: string;
    failed: string;
    fallback: string;
  };
}

type Status = "idle" | "downloading" | "unzipping" | "loading" | "ready" | "error";

export function TourViewer({ zipUrl, posterUrl, labels }: TourViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let viewer: { dispose?: () => void } | null = null;

    async function load() {
      try {
        if (!hostRef.current) return;
        setStatus("downloading");

        const resp = await fetch(zipUrl);
        if (!resp.ok) throw new Error(`download ${resp.status}`);
        const total = Number(resp.headers.get("content-length") ?? 0);
        const reader = resp.body?.getReader();
        if (!reader) throw new Error("no_stream_reader");

        const chunks: Uint8Array[] = [];
        let received = 0;
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          if (total > 0) setProgress(Math.min(0.6, (received / total) * 0.6));
        }
        if (cancelled) return;

        const zipBytes = new Uint8Array(received);
        let off = 0;
        for (const c of chunks) {
          zipBytes.set(c, off);
          off += c.length;
        }

        setStatus("unzipping");
        setProgress(0.65);
        const fflate = await import("fflate");
        const unzipped = fflate.unzipSync(zipBytes);
        // KIRI returns either {name}.ply directly or wrapped — pick the first .ply.
        const plyEntry = Object.entries(unzipped).find(([n]) =>
          n.toLowerCase().endsWith(".ply"),
        );
        if (!plyEntry) throw new Error("no_ply_in_zip");
        const plyBytes = plyEntry[1];

        setStatus("loading");
        setProgress(0.85);

        // mkkellogg viewer is a side-effecting module, only import on client.
        const GS = await import("@mkkellogg/gaussian-splats-3d");
        const Viewer = (GS as unknown as { Viewer: new (opts: Record<string, unknown>) => {
          addSplatScene: (url: string | ArrayBuffer, opts?: Record<string, unknown>) => Promise<void>;
          start: () => void;
          dispose: () => void;
        } }).Viewer;

        const v = new Viewer({
          cameraUp: [0, 1, 0],
          initialCameraPosition: [0, 0, 5],
          initialCameraLookAt: [0, 0, 0],
          rootElement: hostRef.current,
          sharedMemoryForWorkers: false,
        });
        viewer = v;
        await v.addSplatScene(
          plyBytes.buffer.slice(
            plyBytes.byteOffset,
            plyBytes.byteOffset + plyBytes.byteLength,
          ),
          { format: 0 }, // PLY
        );
        if (cancelled) {
          v.dispose();
          return;
        }
        v.start();
        setStatus("ready");
        setProgress(1);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "unknown");
        setStatus("error");
      }
    }

    load();
    return () => {
      cancelled = true;
      viewer?.dispose?.();
    };
  }, [zipUrl]);

  if (status === "error") {
    return (
      <div className="aspect-video w-full bg-ivory-strong/40 border border-gold-soft flex items-center justify-center text-center p-8">
        {posterUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={posterUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-30"
          />
        )}
        <div className="relative flex flex-col gap-2">
          <p className="text-sm text-ink/70">{labels.failed}</p>
          {error && (
            <p className="text-xs text-ink/45 font-mono">{error}</p>
          )}
          <p className="text-xs text-ink/60">{labels.fallback}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative aspect-video w-full bg-ivory-strong/60 overflow-hidden border border-gold-soft">
      <div ref={hostRef} className="absolute inset-0" />
      {status !== "ready" && (
        <div className="absolute inset-0 flex items-center justify-center bg-ivory-strong/80 backdrop-blur-sm">
          {posterUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={posterUrl}
              alt=""
              className="absolute inset-0 w-full h-full object-cover opacity-50"
            />
          )}
          <div className="relative flex flex-col items-center gap-3">
            <div className="w-48 h-px bg-gold-soft overflow-hidden">
              <div
                className="h-full bg-gold transition-all duration-300"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/70">
              {labels.loading}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
