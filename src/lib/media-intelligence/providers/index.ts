// Provider registry + capability-based selection. In v1 nothing live is
// configured, so selectProvider always resolves to MockProvider.
import type { MediaCapability } from "@/lib/media-intelligence/types";
import type { MediaGenerationProvider } from "@/lib/media-intelligence/providers/types";
import { MockProvider } from "@/lib/media-intelligence/providers/mock";
import { VeoVideoProvider } from "@/lib/media-intelligence/providers/veo";
import {
  KlingProvider,
  RunwayProvider,
  LumaVideoProvider,
  HiggsfieldProvider,
  WanProvider,
  PLACEHOLDER_PROVIDERS,
} from "@/lib/media-intelligence/providers/stubs";

const MOCK = new MockProvider();

export const PROVIDER_REGISTRY: MediaGenerationProvider[] = [
  MOCK,
  new VeoVideoProvider(),
  new KlingProvider(),
  new RunwayProvider(),
  new LumaVideoProvider(),
  new HiggsfieldProvider(),
  new WanProvider(),
  ...PLACEHOLDER_PROVIDERS,
];

export function selectProvider(
  capability: MediaCapability,
  opts: { allowLive?: boolean } = {},
): MediaGenerationProvider {
  if (opts.allowLive) {
    const live = PROVIDER_REGISTRY.find(
      (p) => p.id !== "mock" && p.capabilities.includes(capability) && p.isConfigured(),
    );
    if (live) return live;
  }
  return MOCK;
}
