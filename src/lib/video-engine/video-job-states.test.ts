import { describe, it, expect } from "vitest";
import {
  VIDEO_JOB_STATES,
  VIDEO_JOB_LEGAL_TRANSITIONS,
  VIDEO_JOB_HAPPY_PATH,
  TERMINAL_VIDEO_JOB_STATES,
  canVideoTransition,
  isTerminalVideoJobState,
  assertVideoTransition,
  VideoStateTransitionError,
  type VideoJobState,
} from "./video-job-states";

describe("video job state machine — shape", () => {
  it("includes the two F3-A states between running and rendering", () => {
    expect(VIDEO_JOB_STATES).toContain("validating");
    expect(VIDEO_JOB_STATES).toContain("preparing");
  });
  it("every state has a transition entry", () => {
    for (const s of VIDEO_JOB_STATES) {
      expect(VIDEO_JOB_LEGAL_TRANSITIONS[s]).toBeDefined();
    }
  });
  it("terminal states have no outgoing edges", () => {
    for (const t of TERMINAL_VIDEO_JOB_STATES) {
      expect(VIDEO_JOB_LEGAL_TRANSITIONS[t]).toEqual([]);
      expect(isTerminalVideoJobState(t)).toBe(true);
    }
  });
});

describe("happy path is a legal, ordered spine", () => {
  it("each consecutive pair is a legal transition", () => {
    for (let i = 0; i < VIDEO_JOB_HAPPY_PATH.length - 1; i++) {
      expect(canVideoTransition(VIDEO_JOB_HAPPY_PATH[i], VIDEO_JOB_HAPPY_PATH[i + 1])).toBe(true);
    }
  });
  it("ends at completed", () => {
    expect(VIDEO_JOB_HAPPY_PATH.at(-1)).toBe("completed");
  });
});

describe("illegal jumps are rejected (no skipping stages)", () => {
  const illegal: [VideoJobState, VideoJobState][] = [
    ["queued", "rendering"], // must go through running/validating/preparing
    ["running", "rendering"], // uploaded_video must validate + prepare first
    ["running", "preparing"], // can't skip validating
    ["validating", "rendering"], // can't skip preparing
    ["validating", "uploading"],
    ["preparing", "qa"], // can't skip rendering
    ["rendering", "uploading"], // can't skip qa
    ["qa", "completed"], // must upload first
    ["qa", "cancelled"], // no cancel edge from qa
    ["uploading", "cancelled"], // no cancel edge from uploading
    ["completed", "failed"], // terminal
    ["failed", "queued"], // terminal (recovery is a supervisory reset, not a legal edge)
    ["cancelled", "running"],
  ];
  it.each(illegal)("%s -> %s is illegal", (from, to) => {
    expect(canVideoTransition(from, to)).toBe(false);
  });

  it("assertVideoTransition throws VideoStateTransitionError with the stable code", () => {
    expect(() => assertVideoTransition("running", "rendering")).toThrow(VideoStateTransitionError);
    try {
      assertVideoTransition("qa", "completed");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(VideoStateTransitionError);
      expect((e as VideoStateTransitionError).code).toBe("VIDEO_STATE_TRANSITION_INVALID");
      expect((e as VideoStateTransitionError).from).toBe("qa");
      expect((e as VideoStateTransitionError).to).toBe("completed");
    }
  });

  it("assertVideoTransition passes for a legal edge", () => {
    expect(() => assertVideoTransition("preparing", "rendering")).not.toThrow();
  });
});

describe("failure + cancellation reachability", () => {
  it("every non-terminal working state can fail", () => {
    for (const s of ["running", "validating", "preparing", "rendering", "qa", "uploading"] as VideoJobState[]) {
      expect(canVideoTransition(s, "failed")).toBe(true);
    }
  });
  it("cancellation is only legal up to and including rendering (not qa/uploading)", () => {
    for (const s of ["queued", "running", "validating", "preparing", "rendering"] as VideoJobState[]) {
      expect(canVideoTransition(s, "cancelled")).toBe(true);
    }
    expect(canVideoTransition("qa", "cancelled")).toBe(false);
    expect(canVideoTransition("uploading", "cancelled")).toBe(false);
  });
});
