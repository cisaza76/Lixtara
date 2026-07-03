// PURE hero-shot selection. Deterministic and fully unit-testable — this is the
// "orchestration" intelligence: narrative order + one-best-per-room + drop
// low-quality and duplicates.
import type {
  Asset,
  Classification,
  QualityScore,
  RoomType,
  SelectedShot,
} from "@/lib/media-intelligence/types";

// Real-estate storytelling order. Rooms not listed sort last (stable).
export const NARRATIVE_ORDER: RoomType[] = [
  "fachada", "exterior", "sala", "cocina", "habitacion", "bano",
  "amenity", "lote", "aerea", "plano", "render", "otro",
];

const MIN_QUALITY = 0.25; // below this a shot is not usable

export class SelectionEmptyError extends Error {
  constructor() {
    super("no usable photos survived selection");
    this.name = "SelectionEmptyError";
  }
}

const MOTION_BY_ROOM: Partial<Record<RoomType, string>> = {
  fachada: "slow push-in on the entrance",
  sala: "gentle dolly across the living space",
  cocina: "smooth pan along the counters",
  aerea: "slow reveal of the lot",
};

export function selectHeroShots(
  assets: Asset[],
  classifications: Classification[],
  scores: QualityScore[],
  opts: { cap?: number } = {},
): SelectedShot[] {
  const cap = opts.cap ?? 12;
  const clsById = new Map(classifications.map((c) => [c.photoId, c]));
  const scoreById = new Map(scores.map((s) => [s.photoId, s]));

  // Keep usable, non-duplicate assets.
  const usable = assets.filter((a) => {
    const s = scoreById.get(a.photoId);
    if (!s) return false;
    if (s.duplicateOf) return false;
    return s.overall >= MIN_QUALITY;
  });

  // One best-quality shot per room type.
  const bestPerRoom = new Map<RoomType, { photoId: string; overall: number }>();
  for (const a of usable) {
    const cls = clsById.get(a.photoId);
    const s = scoreById.get(a.photoId);
    if (!cls || !s) continue;
    const cur = bestPerRoom.get(cls.roomType);
    if (!cur || s.overall > cur.overall) {
      bestPerRoom.set(cls.roomType, { photoId: a.photoId, overall: s.overall });
    }
  }

  if (bestPerRoom.size === 0) throw new SelectionEmptyError();

  // Emit in narrative order.
  const shots: SelectedShot[] = [];
  let order = 0;
  for (const room of NARRATIVE_ORDER) {
    const pick = bestPerRoom.get(room);
    if (!pick) continue;
    shots.push({
      photoId: pick.photoId,
      order: order++,
      roomType: room,
      reason: `best ${room} shot (quality ${pick.overall.toFixed(2)})`,
      suggestedMotion: MOTION_BY_ROOM[room] ?? "subtle push-in",
    });
    if (shots.length >= cap) break;
  }
  return shots;
}
