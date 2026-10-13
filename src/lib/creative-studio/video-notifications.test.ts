import { describe, expect, it } from "vitest";
import { buildVideoTerminalEmail } from "@/lib/creative-studio/video-notifications";

// UX 5C — terminal email content. Bilingual (EN + ES in one message, matching the
// pilot cohort), reassuring tone, and the strict no-leak contract: no error codes,
// no categories, no internal identifiers. The reference code appears ONLY in failures.
describe("buildVideoTerminalEmail", () => {
  const base = { addressLine: "211 W Watrous Ave", dashboardUrl: "https://lixtara.com/en/dashboard" };

  it("success: invites the seller back to review/download; no reference code", () => {
    const m = buildVideoTerminalEmail({ ...base, outcome: "completed" });
    expect(m.subject.toLowerCase()).toContain("ready");
    expect(m.html).toContain("211 W Watrous Ave");
    expect(m.html).toContain(base.dashboardUrl);
    expect(m.text).not.toContain("Reference");
    expect(m.html).toContain("Tu video"); // ES section present
  });

  it("technical failure: reassuring, includes reference, invites retry", () => {
    const m = buildVideoTerminalEmail({ ...base, outcome: "failed", kind: "technical_retryable", reference: "A7F31C2D" });
    expect(m.text).toContain("A7F31C2D");
    expect(m.text.toLowerCase()).toContain("try again");
    expect(m.html).toContain(base.dashboardUrl);
  });

  it("source failure: asks for a replacement file, includes reference, does NOT invite retry", () => {
    const m = buildVideoTerminalEmail({ ...base, outcome: "failed", kind: "source_action_required", reference: "A7F31C2D" });
    expect(m.text.toLowerCase()).toContain("replace");
    expect(m.text.toLowerCase()).not.toContain("try again");
    expect(m.text).toContain("A7F31C2D");
  });

  it("support failure: points at support with the reference; no retry invitation", () => {
    const m = buildVideoTerminalEmail({ ...base, outcome: "failed", kind: "technical_support", reference: "A7F31C2D" });
    expect(m.text.toLowerCase()).toContain("support");
    expect(m.text.toLowerCase()).not.toContain("try again");
  });

  it("known recipient language: the message is only in that language", () => {
    const es = buildVideoTerminalEmail({ ...base, outcome: "completed", lang: "es" });
    expect(es.subject).toContain("Tu video");
    expect(es.html).toContain("Tu video");
    expect(es.html).not.toContain("Your listing video");
    const en = buildVideoTerminalEmail({ ...base, outcome: "failed", kind: "technical_retryable", reference: "A7F31C2D", lang: "en" });
    expect(en.text).toContain("A7F31C2D");
    expect(en.text).not.toContain("Referencia");
    const esFail = buildVideoTerminalEmail({ ...base, outcome: "failed", kind: "source_action_required", reference: "A7F31C2D", lang: "es" });
    expect(esFail.subject).toContain("otro archivo");
    expect(esFail.text).toContain("Referencia: A7F31C2D");
    expect(esFail.text).not.toContain("Reference:");
  });

  it("never leaks technical vocabulary in any variant", () => {
    for (const kind of ["technical_retryable", "source_action_required", "technical_support"] as const) {
      const m = buildVideoTerminalEmail({ ...base, outcome: "failed", kind, reference: "AAAA1111" });
      const all = (m.subject + m.html + m.text).toLowerCase();
      for (const banned of ["error_code", "errorcode", "sandbox", "snapshot", "stderr", "ffmpeg", "render_", "trace", "quota", "grant", "generation"]) {
        expect(all, `${kind} leaks "${banned}"`).not.toContain(banned);
      }
    }
  });
});
