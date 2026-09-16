import { describe, it, expect } from "vitest";
import { MAX_VISION_IMAGE_DIMENSION, planVisionResize } from "./vision-image";

// Incidente 2026-08-11: una foto de 8160×6120 hizo que Anthropic devolviera 400
// ("image dimensions exceed max allowed size: 8000 pixels") y /generate reventara con
// una excepción no capturada, ANTES de crear el job. Estas pruebas fijan la decisión de
// redimensionado: pura, sin I/O, sin sharp.

describe("MAX_VISION_IMAGE_DIMENSION", () => {
  it("deja margen de seguridad por debajo del límite del proveedor (8000 px)", () => {
    expect(MAX_VISION_IMAGE_DIMENSION).toBeLessThan(8000);
    // Un margen ridículo (p. ej. 7999) no protege de diferencias de redondeo del proveedor.
    expect(8000 - MAX_VISION_IMAGE_DIMENSION).toBeGreaterThanOrEqual(500);
    // Y no debe ser tan pequeño que degrade la clasificación de habitaciones.
    expect(MAX_VISION_IMAGE_DIMENSION).toBeGreaterThanOrEqual(2000);
  });
});

describe("planVisionResize — no trabajar de más", () => {
  it("una imagen dentro del límite pasa tal cual (sin recodificar)", () => {
    expect(planVisionResize({ width: 4000, height: 3000 })).toEqual({ action: "passthrough" });
  });

  it("exactamente en el límite pasa tal cual (el límite es inclusivo)", () => {
    const d = MAX_VISION_IMAGE_DIMENSION;
    expect(planVisionResize({ width: d, height: d })).toEqual({ action: "passthrough" });
  });

  it("NUNCA hace upscale de una imagen pequeña", () => {
    expect(planVisionResize({ width: 800, height: 533 })).toEqual({ action: "passthrough" });
  });
});

describe("planVisionResize — reducción preservando aspect ratio", () => {
  it("el caso real del incidente: 8160×6120 se reduce por debajo del límite", () => {
    const plan = planVisionResize({ width: 8160, height: 6120 });
    expect(plan.action).toBe("resize");
    if (plan.action !== "resize") throw new Error("unreachable");
    expect(Math.max(plan.width, plan.height)).toBeLessThanOrEqual(MAX_VISION_IMAGE_DIMENSION);
    // 8160/6120 = 4:3 exacto → debe conservarse
    expect(plan.width / plan.height).toBeCloseTo(8160 / 6120, 5);
  });

  it("apaisada: limita el ancho y escala el alto", () => {
    const plan = planVisionResize({ width: 12000, height: 3000 });
    if (plan.action !== "resize") throw new Error("esperaba resize");
    expect(plan.width).toBe(MAX_VISION_IMAGE_DIMENSION);
    expect(plan.height).toBe(Math.round((3000 * MAX_VISION_IMAGE_DIMENSION) / 12000));
  });

  it("vertical: limita el alto y escala el ancho", () => {
    const plan = planVisionResize({ width: 3000, height: 12000 });
    if (plan.action !== "resize") throw new Error("esperaba resize");
    expect(plan.height).toBe(MAX_VISION_IMAGE_DIMENSION);
    expect(plan.width).toBe(Math.round((3000 * MAX_VISION_IMAGE_DIMENSION) / 12000));
  });

  it("el resultado nunca excede el límite en NINGUNA dimensión", () => {
    for (const [w, h] of [[8160, 6120], [20000, 19999], [9000, 500], [500, 9000], [8001, 8001]]) {
      const plan = planVisionResize({ width: w, height: h });
      if (plan.action !== "resize") throw new Error(`esperaba resize para ${w}x${h}`);
      expect(plan.width).toBeLessThanOrEqual(MAX_VISION_IMAGE_DIMENSION);
      expect(plan.height).toBeLessThanOrEqual(MAX_VISION_IMAGE_DIMENSION);
      expect(plan.width).toBeGreaterThan(0);
      expect(plan.height).toBeGreaterThan(0);
    }
  });

  it("una dimensión desconocida (0/NaN) se trata como redimensionable, no como passthrough", () => {
    // Fallar hacia el lado seguro: si no sabemos el tamaño, no lo mandamos crudo.
    expect(planVisionResize({ width: 0, height: 0 }).action).toBe("resize");
    expect(planVisionResize({ width: Number.NaN, height: 3000 }).action).toBe("resize");
  });
});

// ---- Adaptador: decide + aplica, con puertos inyectados (sin red, sin sharp real) -------
import { normalizeImageForVision, MAX_VISION_FETCH_BYTES, type VisionImageDeps } from "./vision-image";

function deps(over: Partial<VisionImageDeps> = {}): VisionImageDeps {
  return {
    fetchBytes: over.fetchBytes ?? (async () => new Uint8Array(1024)),
    probe: over.probe ?? (async () => ({ width: 4000, height: 3000 })),
    resize: over.resize ?? (async (_b, w, h) => ({ bytes: new Uint8Array(64), width: w, height: h })),
    ...over,
  };
}

describe("normalizeImageForVision", () => {
  it("dentro del límite: NO descarga ni recodifica, envía la URL tal cual", async () => {
    let fetched = 0, resized = 0;
    const r = await normalizeImageForVision("https://x/ok.jpg", deps({
      fetchBytes: async () => { fetched += 1; return new Uint8Array(10); },
      probe: async () => ({ width: 4000, height: 3000 }),
      resize: async () => { resized += 1; return { bytes: new Uint8Array(1), width: 1, height: 1 }; },
    }));
    expect(r.kind).toBe("url");
    expect(resized).toBe(0);
    expect(fetched).toBe(1); // una sola descarga para medir
  });

  it("el caso real 8160×6120: se redimensiona y viaja en línea, no como URL", async () => {
    const r = await normalizeImageForVision("https://x/big.jpg", deps({
      probe: async () => ({ width: 8160, height: 6120 }),
      resize: async (_b, w, h) => ({ bytes: new Uint8Array([1, 2, 3]), width: w, height: h }),
    }));
    expect(r.kind).toBe("inline");
    if (r.kind !== "inline") throw new Error("unreachable");
    expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(MAX_VISION_IMAGE_DIMENSION);
    expect(r.mime).toBe("image/jpeg");
    expect(r.base64.length).toBeGreaterThan(0);
  });

  it("una imagen enorme por bytes se rechaza de forma CONTROLADA (no OOM, no excepción cruda)", async () => {
    await expect(
      normalizeImageForVision("https://x/huge.jpg", deps({
        fetchBytes: async () => { throw new Error(`image exceeds ${MAX_VISION_FETCH_BYTES} bytes`); },
      })),
    ).rejects.toThrow(/exceeds/);
  });

  it("no persiste nada: el puerto de escritura ni siquiera existe en la interfaz", () => {
    const d = deps();
    expect(Object.keys(d).sort()).toEqual(["fetchBytes", "probe", "resize"]);
  });

  it("MAX_VISION_FETCH_BYTES acota la memoria por imagen", () => {
    expect(MAX_VISION_FETCH_BYTES).toBeGreaterThan(5 * 1024 * 1024);
    expect(MAX_VISION_FETCH_BYTES).toBeLessThanOrEqual(50 * 1024 * 1024);
  });
});
