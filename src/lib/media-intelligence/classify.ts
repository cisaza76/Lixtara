// LLM node: classify each photo by room type using Claude Vision. The object
// generator is injected for testability; production uses generateObject.
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { ROOM_TYPES, type Asset, type Classification } from "@/lib/media-intelligence/types";
import {
  normalizeImageForVision,
  MAX_VISION_FETCH_BYTES,
  type VisionImageDeps,
} from "@/lib/media-intelligence/vision-image";

const MODEL = "claude-sonnet-4-6";

export type ObjectGenerator = (args: {
  model: unknown;
  schema: unknown;
  messages: unknown;
}) => Promise<{ object: unknown }>;

const classificationsSchema = z.object({
  classifications: z.array(
    z.object({
      photoId: z.string(),
      roomType: z.enum(ROOM_TYPES),
      tags: z.array(z.string()),
      confidence: z.number(),
    }),
  ),
});

// Adaptador real de normalización (sharp + fetch acotado). Se inyecta para poder testear
// `classifyAssets` sin red ni sharp.
const sharpVisionDeps: VisionImageDeps = {
  async fetchBytes(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`photo fetch failed: ${res.status}`);
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > MAX_VISION_FETCH_BYTES) {
      throw new Error(`photo exceeds ${MAX_VISION_FETCH_BYTES} bytes`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_VISION_FETCH_BYTES) {
      throw new Error(`photo exceeds ${MAX_VISION_FETCH_BYTES} bytes`);
    }
    return buf;
  },
  async probe(bytes) {
    const sharp = (await import("sharp")).default;
    // `rotate()` aplica la orientación EXIF ANTES de medir: una foto vertical de móvil
    // guardada como apaisada + rotación mediría al revés y podría decidirse mal.
    const meta = await sharp(bytes).rotate().metadata();
    return { width: meta.width ?? 0, height: meta.height ?? 0 };
  },
  async resize(bytes, width, height) {
    const sharp = (await import("sharp")).default;
    const out = await sharp(bytes)
      .rotate()
      .resize({ width, height, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { bytes: new Uint8Array(out.data), width: out.info.width, height: out.info.height };
  },
};

export async function classifyAssets(
  assets: Asset[],
  deps: { generate?: ObjectGenerator; vision?: VisionImageDeps } = {},
): Promise<Classification[]> {
  if (assets.length === 0) return [];
  const generate = (deps.generate ?? (generateObject as unknown as ObjectGenerator));
  const vision = deps.vision ?? sharpVisionDeps;

  // Normalización previa (incidente 2026-08-11): una foto de 8160×6120 supera el límite de
  // 8000 px del proveedor y provocaba un 400. Las imágenes dentro del límite se siguen
  // enviando por URL; solo las que exceden viajan reducidas y en línea. Los originales del
  // listing NO se tocan: la copia es en memoria y se descarta al terminar.
  const normalized = await Promise.all(assets.map((a) => normalizeImageForVision(a.url, vision)));
  const { object } = await generate({
    model: anthropic(MODEL),
    schema: classificationsSchema,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Classify each real-estate photo by room type. Return one entry per " +
              "photoId. Room types: " + ROOM_TYPES.join(", ") + ". " +
              "photoIds in order: " + assets.map((a) => a.photoId).join(", "),
          },
          // Cada imagen ya normalizada: URL si estaba dentro del límite, bytes reducidos
          // si lo excedía. El modelo recibe siempre dimensiones válidas.
          ...normalized.map((n) =>
            n.kind === "url"
              ? { type: "image" as const, image: n.url }
              : { type: "image" as const, image: `data:${n.mime};base64,${n.base64}` },
          ),
        ],
      },
    ],
  });
  const parsed = classificationsSchema.parse(object);
  return parsed.classifications;
}
