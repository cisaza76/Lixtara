import { describe, it, expect, afterEach } from "vitest";
import { isMediaAgentEnabled } from "@/app/api/media-agent/generate/route";

describe("isMediaAgentEnabled", () => {
  const prev = process.env.MEDIA_AGENT_ENABLED;
  afterEach(() => {
    process.env.MEDIA_AGENT_ENABLED = prev;
  });
  it("is off unless the env flag is exactly 'true'", () => {
    process.env.MEDIA_AGENT_ENABLED = undefined;
    expect(isMediaAgentEnabled()).toBe(false);
    process.env.MEDIA_AGENT_ENABLED = "false";
    expect(isMediaAgentEnabled()).toBe(false);
    process.env.MEDIA_AGENT_ENABLED = "true";
    expect(isMediaAgentEnabled()).toBe(true);
  });
});
