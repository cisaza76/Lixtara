"use client";

// 3D Gaussian Splatting viewer using `gsplat`. Swapped from
// @mkkellogg/gaussian-splats-3d after that lib threw a "Cannot read
// properties of undefined (reading 'splatCount')" error on KIRI's standard
// Inria/Kerbl .ply output (349k splats, all expected fields present).
//
// Flow: fetch the .zip from Supabase Storage → fflate unzipSync →
// extract 3DGS.ply → PLYLoader.LoadFromArrayBuffer → render loop.

import { useEffect, useRef, useState } from "react";

interface TourViewerProps {
  /** Signed Supabase Storage URL pointing at the KIRI .zip (contains 3DGS.ply). */
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let rafId: number | null = null;
    let cleanup: (() => void) | null = null;

    async function load() {
      try {
        if (!canvasRef.current) return;
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
        setProgress(0.7);
        const fflate = await import("fflate");
        const unzipped = fflate.unzipSync(zipBytes);
        const plyEntry = Object.entries(unzipped).find(([n]) =>
          n.toLowerCase().endsWith(".ply"),
        );
        if (!plyEntry) throw new Error("no_ply_in_zip");
        const plyBytes = plyEntry[1];

        setStatus("loading");
        setProgress(0.85);

        const SPLAT = await import("gsplat");
        const renderer = new SPLAT.WebGLRenderer(canvasRef.current);
        const scene = new SPLAT.Scene();
        const camera = new SPLAT.Camera();
        const controls = new SPLAT.OrbitControls(camera, canvasRef.current);

        SPLAT.PLYLoader.LoadFromArrayBuffer(
          plyBytes.buffer.slice(
            plyBytes.byteOffset,
            plyBytes.byteOffset + plyBytes.byteLength,
          ),
          scene,
        );

        const handleResize = () => {
          if (!canvasRef.current) return;
          renderer.setSize(
            canvasRef.current.clientWidth,
            canvasRef.current.clientHeight,
          );
        };
        handleResize();
        window.addEventListener("resize", handleResize);

        const frame = () => {
          if (cancelled) return;
          controls.update();
          renderer.render(scene, camera);
          rafId = requestAnimationFrame(frame);
        };
        frame();

        cleanup = () => {
          if (rafId !== null) cancelAnimationFrame(rafId);
          window.removeEventListener("resize", handleResize);
          renderer.dispose?.();
        };

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
      cleanup?.();
    };
  }, [zipUrl]);

  if (status === "error") {
    return (
      <div className="relative aspect-video w-full bg-ivory-strong/40 border border-gold-soft flex items-center justify-center text-center p-8">
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
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
      />
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
