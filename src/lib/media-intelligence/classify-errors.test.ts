import { describe, it, expect } from "vitest";
import { classifyVisionFailure, VISION_FAILURE_KINDS } from "./classify-errors";

// Contrato C del encargo: NINGÚN fallo del clasificador puede escapar como excepción 500
// genérica sin clasificar. Cada uno debe declarar si es determinístico (el vendedor debe
// actuar) o transitorio (reintentar tiene sentido).

const apiError = (over: Record<string, unknown> = {}) =>
  Object.assign(new Error("AI_APICallError"), {
    name: "AI_APICallError",
    statusCode: 400,
    isRetryable: false,
    responseBody: '{"type":"error","error":{"message":"generic"}}',
    ...over,
  });

describe("classifyVisionFailure — taxonomía cerrada", () => {
  it("el conjunto de tipos es cerrado y estable", () => {
    expect([...VISION_FAILURE_KINDS].sort()).toEqual(
      ["image_too_large", "invalid_response", "provider_rejected", "provider_unavailable", "unknown"].sort(),
    );
  });

  it("nunca devuelve null/undefined: cualquier entrada se clasifica", () => {
    for (const input of [null, undefined, "texto", 42, {}, new Error("x")]) {
      const r = classifyVisionFailure(input);
      expect(VISION_FAILURE_KINDS).toContain(r.kind);
      expect(typeof r.retryable).toBe("boolean");
    }
  });
});

describe("classifyVisionFailure — dimensión excesiva (el incidente real)", () => {
  it("reconoce el 400 de dimensiones de Anthropic como image_too_large y NO retryable", () => {
    const err = apiError({
      responseBody:
        '{"type":"error","error":{"type":"invalid_request_error","message":"messages.0.content.10.image.source.url: At least one of the image dimensions exceed max allowed size: 8000 pixels"}}',
    });
    const r = classifyVisionFailure(err);
    expect(r.kind).toBe("image_too_large");
    expect(r.retryable).toBe(false);
  });

  it("también lo reconoce si el mensaje viene en err.message en vez del body", () => {
    const err = apiError({ message: "At least one of the image dimensions exceed max allowed size: 8000 pixels" });
    expect(classifyVisionFailure(err).kind).toBe("image_too_large");
  });
});

describe("classifyVisionFailure — resto de modos", () => {
  it("4xx que no es de dimensiones → provider_rejected, determinístico", () => {
    const r = classifyVisionFailure(apiError({ statusCode: 422, responseBody: '{"error":{"message":"bad input"}}' }));
    expect(r.kind).toBe("provider_rejected");
    expect(r.retryable).toBe(false);
  });

  it("429 → provider_unavailable y SÍ retryable (es presión momentánea)", () => {
    const r = classifyVisionFailure(apiError({ statusCode: 429, isRetryable: true }));
    expect(r.kind).toBe("provider_unavailable");
    expect(r.retryable).toBe(true);
  });

  it("5xx → provider_unavailable y retryable", () => {
    for (const s of [500, 502, 503, 529]) {
      const r = classifyVisionFailure(apiError({ statusCode: s, isRetryable: true }));
      expect(r.kind).toBe("provider_unavailable");
      expect(r.retryable).toBe(true);
    }
  });

  it("timeout / red caída → provider_unavailable y retryable", () => {
    for (const e of [
      Object.assign(new Error("fetch failed"), { name: "TypeError" }),
      Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
      Object.assign(new Error("timeout of 30000ms exceeded"), { name: "Error" }),
    ]) {
      const r = classifyVisionFailure(e);
      expect(r.kind).toBe("provider_unavailable");
      expect(r.retryable).toBe(true);
    }
  });

  it("respuesta que no valida contra el esquema (Zod) → invalid_response, NO retryable", () => {
    const zodish = Object.assign(new Error("Validation error"), { name: "ZodError", issues: [{ path: ["classifications"] }] });
    const r = classifyVisionFailure(zodish);
    expect(r.kind).toBe("invalid_response");
    expect(r.retryable).toBe(false);
  });

  it("lo desconocido se marca unknown y NO retryable (no prometer que reintentar sirve)", () => {
    const r = classifyVisionFailure(new Error("algo raro"));
    expect(r.kind).toBe("unknown");
    expect(r.retryable).toBe(false);
  });
});

describe("classifyVisionFailure — no filtra detalles del proveedor", () => {
  it("el resultado no contiene el nombre del proveedor, el modelo ni el request_id", () => {
    const err = apiError({
      message: "AI_APICallError from api.anthropic.com model claude-sonnet-4-6",
      responseBody: '{"error":{"message":"dimensions exceed max allowed size: 8000 pixels"},"request_id":"req_011Cdwg"}',
    });
    const payload = JSON.stringify(classifyVisionFailure(err));
    expect(payload).not.toMatch(/anthropic|claude|req_|sonnet/i);
  });
});
