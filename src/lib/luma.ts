// Luma Uni-1 Agents API wrapper — image generation + editing only.
//
// Per Luma support (email thread 2026-05-24): Luma has TWO separate API
// systems with separate keys/billing. We use the Agents/Uni-1 system at
// `agents.lumalabs.ai`. Dream Machine (`api.lumalabs.ai/dream-machine`) is
// a different product and our key does not work there. Neither system
// produces 3D — that's why our key is scoped to image work (virtual staging,
// AI staging copy enhancement, etc.).
//
// Docs: https://docs.agents.lumalabs.ai/guides/image-editing

const BASE = "https://agents.lumalabs.ai/v1";

function apiKey(): string {
  const k = process.env.LUMA_API_KEY;
  if (!k) throw new Error("LUMA_API_KEY not configured");
  return k;
}

export type GenerationState =
  | "queued"
  | "dreaming"
  | "completed"
  | "failed";

export interface Generation {
  id: string;
  type: string;
  state: GenerationState;
  model: string;
  output?: Array<{ type: string; url: string }>;
  failure_reason?: string | null;
  failure_code?: string | null;
}

async function lumaRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Luma ${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return (await res.json()) as T;
}

export interface ImageEditInput {
  prompt: string;
  sourceUrl: string;
  // uni-1 (cheaper) vs uni-1-max (higher quality). Default uni-1 for now.
  model?: "uni-1" | "uni-1-max";
}

export async function startImageEdit(input: ImageEditInput): Promise<Generation> {
  if (input.prompt.length === 0 || input.prompt.length > 6000) {
    throw new Error(`prompt length out of range: ${input.prompt.length} (1-6000)`);
  }
  return lumaRequest<Generation>("POST", "/generations", {
    type: "image_edit",
    prompt: input.prompt,
    source: { url: input.sourceUrl },
    model: input.model ?? "uni-1",
  });
}

export async function getGeneration(id: string): Promise<Generation> {
  return lumaRequest<Generation>("GET", `/generations/${id}`);
}

/**
 * Poll until the generation completes or fails. Throws on failure or timeout.
 * Returns the completed Generation (with `output[0].url` populated).
 */
export async function waitForCompletion(
  id: string,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<Generation> {
  const timeoutMs = opts.timeoutMs ?? 4 * 60_000; // 4 min — typical edit ~30-90s
  const pollMs = opts.pollMs ?? 3000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const g = await getGeneration(id);
    if (g.state === "completed") return g;
    if (g.state === "failed") {
      throw new Error(
        `Luma generation ${id} failed: ${g.failure_reason ?? "unknown"} (code ${g.failure_code ?? "?"})`,
      );
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Luma generation ${id} timed out after ${timeoutMs}ms`);
}
