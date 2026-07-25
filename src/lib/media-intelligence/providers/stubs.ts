// Not-yet-configured engine adapters. They advertise their capability so the
// registry knows they exist, but throw until their slice wires the real API.
import type { MediaCapability } from "@/lib/media-intelligence/types";
import {
  ProviderNotConfiguredError,
  type GeneratedDeliverable,
  type MediaGenInput,
  type MediaGenerationProvider,
} from "@/lib/media-intelligence/providers/types";

class NotConfiguredProvider implements MediaGenerationProvider {
  constructor(
    readonly id: string,
    readonly capabilities: readonly MediaCapability[],
  ) {}
  isConfigured(): boolean {
    return false;
  }
  async generate(_input: MediaGenInput): Promise<GeneratedDeliverable> {
    throw new ProviderNotConfiguredError(this.id);
  }
}

export class KlingProvider extends NotConfiguredProvider {
  constructor() { super("kling", ["video"]); }
}
export class RunwayProvider extends NotConfiguredProvider {
  constructor() { super("runway", ["video"]); }
}
export class LumaVideoProvider extends NotConfiguredProvider {
  constructor() { super("luma", ["video", "image"]); }
}
export class HiggsfieldProvider extends NotConfiguredProvider {
  constructor() { super("higgsfield", ["video"]); }
}
export class WanProvider extends NotConfiguredProvider {
  constructor() { super("wan", ["video"]); }
}

// Placeholder providers for capabilities with no engine yet.
export const PLACEHOLDER_PROVIDERS: MediaGenerationProvider[] = [
  new NotConfiguredProvider("placeholder-image", ["image"]),
  new NotConfiguredProvider("placeholder-presentation", ["presentation"]),
  new NotConfiguredProvider("placeholder-tour", ["tour"]),
  new NotConfiguredProvider("placeholder-3d", ["three_d"]),
  new NotConfiguredProvider("placeholder-voice", ["voice"]),
];
