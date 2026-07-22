import { describe, it, expect } from "vitest";
import {
  buildFontGuardCommand,
  parseFontGuardOutput,
  evaluateFontGuard,
  EXPECTED_FACES,
  FONT_DIR,
  type FontGuardProbe,
} from "@/lib/video-engine/font-guard";
import { BASE_ARTIFACT_VERSION, FONT_STRATEGY } from "@/lib/video-engine/versions";

const goodFc = (): Record<string, string> =>
  Object.fromEntries(EXPECTED_FACES.map((f) => [f.file, `${FONT_DIR}/${f.file}`]));

function probe(over: Partial<FontGuardProbe> = {}): FontGuardProbe {
  return { version: BASE_ARTIFACT_VERSION, strategy: FONT_STRATEGY, fcMatch: goodFc(), ...over };
}
const check = (p: FontGuardProbe) =>
  evaluateFontGuard({ expectedVersion: BASE_ARTIFACT_VERSION, expectedStrategy: FONT_STRATEGY, probe: p });

describe("evaluateFontGuard — fail-closed code<->snapshot compatibility", () => {
  it("system code + correct system snapshot (all four faces) → passes", () => {
    expect(check(probe())).toEqual({ ok: true });
  });

  it("system code + OLD snapshot (no manifests) → fails", () => {
    const r = check(probe({ version: "MISSING", strategy: "MISSING", fcMatch: {} }));
    expect(r.ok).toBe(false);
  });

  it("version manifest absent → fails", () => {
    expect(check(probe({ version: "MISSING" })).ok).toBe(false);
  });

  it("strategy manifest absent → fails", () => {
    expect(check(probe({ strategy: "MISSING" })).ok).toBe(false);
  });

  it("different artifact version → fails", () => {
    const r = check(probe({ version: "base-2026-07-19-ffmpeg8.1.2-remotion4.0.489" }));
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/artifact version/);
  });

  it("different font strategy → fails", () => {
    const r = check(probe({ strategy: "runtime" }));
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/font strategy/);
  });

  it("a required face missing from fc-match → fails", () => {
    const fc = goodFc();
    fc["Inter-600.ttf"] = "MISSING";
    expect(check(probe({ fcMatch: fc })).ok).toBe(false);
  });

  it("a face resolving OUTSIDE /usr/share/fonts/lixtara (silent fallback) → fails", () => {
    const fc = goodFc();
    fc["PlayfairDisplay-500.ttf"] = "/usr/share/fonts/dejavu/DejaVuSerif.ttf";
    const r = check(probe({ fcMatch: fc }));
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(new RegExp(`outside ${FONT_DIR}`));
  });

  it("all four faces resolving to the exact installed files → passes", () => {
    expect(check(probe({ fcMatch: goodFc() })).ok).toBe(true);
  });
});

describe("font-guard command + parser", () => {
  it("command reads both manifests and fc-matches all four faces", () => {
    const cmd = buildFontGuardCommand();
    expect(cmd).toContain("/etc/lixtara-artifact-version");
    expect(cmd).toContain("/etc/lixtara-font-strategy");
    for (const f of EXPECTED_FACES) {
      expect(cmd).toContain(f.match);
      expect(cmd).toContain(f.file);
    }
  });

  it("parses a realistic guard stdout back into a probe", () => {
    const stdout = [
      `VERSION=${BASE_ARTIFACT_VERSION}`,
      `STRATEGY=${FONT_STRATEGY}`,
      ...EXPECTED_FACES.map((f) => `FC ${f.file}=${FONT_DIR}/${f.file}`),
    ].join("\n");
    const p = parseFontGuardOutput(stdout);
    expect(p.version).toBe(BASE_ARTIFACT_VERSION);
    expect(p.strategy).toBe(FONT_STRATEGY);
    expect(p.fcMatch["Inter-600.ttf"]).toBe(`${FONT_DIR}/Inter-600.ttf`);
    // and the parsed probe passes the guard
    expect(check(p)).toEqual({ ok: true });
  });
});
