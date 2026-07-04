import { describe, it, expect } from "vitest";
import { selectHeroShots, SelectionEmptyError } from "@/lib/media-intelligence/select";
import type { Asset, Classification, QualityScore } from "@/lib/media-intelligence/types";

const asset = (id: string): Asset => ({ photoId: id, url: `http://x/${id}` });
const cls = (id: string, roomType: Classification["roomType"]): Classification =>
  ({ photoId: id, roomType, tags: [], confidence: 0.9 });
const q = (id: string, overall: number, dup?: string): QualityScore =>
  ({ photoId: id, sharpness: overall, lighting: overall, framing: overall, overall, duplicateOf: dup });

describe("selectHeroShots", () => {
  it("orders shots by real-estate narrative and keeps one best per room", () => {
    const assets = [asset("a"), asset("b"), asset("c"), asset("d")];
    const classes = [cls("a", "cocina"), cls("b", "fachada"), cls("c", "cocina"), cls("d", "sala")];
    const scores = [q("a", 0.6), q("b", 0.9), q("c", 0.8), q("d", 0.7)];
    const out = selectHeroShots(assets, classes, scores);
    // fachada first, then sala, then cocina (best of a/c = c)
    expect(out.map((s) => s.roomType)).toEqual(["fachada", "sala", "cocina"]);
    expect(out.find((s) => s.roomType === "cocina")!.photoId).toBe("c");
    out.forEach((s, i) => expect(s.order).toBe(i));
  });

  it("drops duplicates and low-quality shots", () => {
    const assets = [asset("a"), asset("b")];
    const classes = [cls("a", "sala"), cls("b", "bano")];
    const scores = [q("a", 0.8), q("b", 0.1, "a")]; // b is a dupe + low quality
    const out = selectHeroShots(assets, classes, scores);
    expect(out.map((s) => s.photoId)).toEqual(["a"]);
  });

  it("throws SelectionEmptyError when nothing survives", () => {
    const assets = [asset("a")];
    const classes = [cls("a", "sala")];
    const scores = [q("a", 0.05)];
    expect(() => selectHeroShots(assets, classes, scores)).toThrow(SelectionEmptyError);
  });
});
