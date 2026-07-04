import type { MediaCapability } from "@/lib/media-intelligence/types";
import type { MediaSpecialist } from "@/lib/media-intelligence/agents/types";
import { VideoSpecialist } from "@/lib/media-intelligence/agents/video-specialist";
import { makeStubSpecialist } from "@/lib/media-intelligence/agents/stub-specialist";

export const SPECIALISTS: Record<MediaCapability, MediaSpecialist> = {
  video: new VideoSpecialist(),
  image: makeStubSpecialist("image"),
  presentation: makeStubSpecialist("presentation"),
  tour: makeStubSpecialist("tour"),
  three_d: makeStubSpecialist("three_d"),
  voice: makeStubSpecialist("voice"),
};

export function getSpecialist(capability: MediaCapability): MediaSpecialist {
  return SPECIALISTS[capability];
}
