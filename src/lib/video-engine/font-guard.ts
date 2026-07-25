// Fail-closed font-strategy guard. Runs IN the sandbox BEFORE the render is opened and
// proves the running code and the base-artifact snapshot are a compatible pair:
//   - the code's declared BASE_ARTIFACT_VERSION == the snapshot's /etc/lixtara-artifact-version
//   - the code's declared font strategy      == the snapshot's /etc/lixtara-font-strategy
//   - each of the four required faces resolves (fc-match) to the exact file under
//     /usr/share/fonts/lixtara/ — never a silent fallback.
// Any mismatch throws FontStrategyMismatchError -> job fails FONT_STRATEGY_MISMATCH, and NO
// MP4 is ever produced with the wrong font source. This is the guard that makes the
// dangerous "system code + old snapshot (no system fonts)" combination impossible to reach
// silently (see the F1-M plan's compatibility matrix).

export const FONT_DIR = "/usr/share/fonts/lixtara";

// The four faces ListingVideo.tsx uses, each with the fc-match pattern that MUST resolve to
// the exact installed TTF. Order-independent.
export const EXPECTED_FACES: ReadonlyArray<{ match: string; file: string }> = [
  { match: "Playfair Display:weight=medium", file: "PlayfairDisplay-500.ttf" },
  { match: "Playfair Display:weight=semibold", file: "PlayfairDisplay-600.ttf" },
  { match: "Playfair Display:weight=medium:slant=100", file: "PlayfairDisplay-500Italic.ttf" },
  { match: "Inter:weight=semibold", file: "Inter-600.ttf" },
];

export class FontStrategyMismatchError extends Error {
  constructor(reason: string) {
    super(`FONT_STRATEGY_MISMATCH: ${reason}`);
    this.name = "FontStrategyMismatchError";
  }
}

export interface FontGuardProbe {
  version: string;
  strategy: string;
  fcMatch: Record<string, string>; // ttf filename -> resolved absolute path (or "MISSING")
}

// A single `sh -c` string. Deliberately CANNOT fail on its own (every read falls back to
// "MISSING") so the DECISION is made in typed code (evaluateFontGuard), not swallowed by a
// non-zero shell exit that a caller might misread.
export function buildFontGuardCommand(): string {
  const lines = [
    "echo VERSION=$(cat /etc/lixtara-artifact-version 2>/dev/null || echo MISSING)",
    "echo STRATEGY=$(cat /etc/lixtara-font-strategy 2>/dev/null || echo MISSING)",
    ...EXPECTED_FACES.map(
      (f) => `echo "FC ${f.file}=$(fc-match -f '%{file}' '${f.match}' 2>/dev/null || echo MISSING)"`,
    ),
  ];
  return lines.join("; ");
}

export function parseFontGuardOutput(stdout: string): FontGuardProbe {
  const version = /^VERSION=(.*)$/m.exec(stdout)?.[1]?.trim() ?? "MISSING";
  const strategy = /^STRATEGY=(.*)$/m.exec(stdout)?.[1]?.trim() ?? "MISSING";
  const fcMatch: Record<string, string> = {};
  for (const m of stdout.matchAll(/^FC ([^=]+)=(.*)$/gm)) fcMatch[m[1].trim()] = m[2].trim();
  return { version, strategy, fcMatch };
}

// Pure decision — unit-tested in isolation. Returns { ok:false, reason } for the first
// incompatibility found; the caller throws FontStrategyMismatchError(reason).
export function evaluateFontGuard(opts: {
  expectedVersion: string;
  expectedStrategy: string;
  probe: FontGuardProbe;
}): { ok: true } | { ok: false; reason: string } {
  const { expectedVersion, expectedStrategy, probe } = opts;
  if (!probe.version || probe.version === "MISSING") return { ok: false, reason: "artifact-version manifest missing" };
  if (!probe.strategy || probe.strategy === "MISSING") return { ok: false, reason: "font-strategy manifest missing" };
  if (probe.version !== expectedVersion)
    return { ok: false, reason: `artifact version "${probe.version}" != expected "${expectedVersion}"` };
  if (probe.strategy !== expectedStrategy)
    return { ok: false, reason: `font strategy "${probe.strategy}" != expected "${expectedStrategy}"` };
  for (const face of EXPECTED_FACES) {
    const resolved = probe.fcMatch[face.file];
    const expectedPath = `${FONT_DIR}/${face.file}`;
    if (!resolved || resolved === "MISSING") return { ok: false, reason: `fc-match missing for ${face.match}` };
    if (resolved !== expectedPath)
      return { ok: false, reason: `${face.match} resolved to "${resolved}" (outside ${FONT_DIR}), expected "${expectedPath}"` };
  }
  return { ok: true };
}
