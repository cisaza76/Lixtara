// F4.6 Stage E — static validation of the OPERATIONAL SQL (runbooks/, not migrations/).
// These files are documentation-grade tools an operator pastes into psql; this test pins their
// safety properties so a future edit cannot silently weaken them. Read-only assertions over
// file content — no DB, no execution.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const RUNBOOKS = resolve(process.cwd(), "docs/superpowers/runbooks");
const verifyPath = resolve(RUNBOOKS, "verify-source-archive.sql");
const restorePath = resolve(RUNBOOKS, "restore-source-archive-by-runid.sql");
const runbookPath = resolve(RUNBOOKS, "2026-07-25-source-asset-archive.md");

const verifySql = readFileSync(verifyPath, "utf8");
const restoreSql = readFileSync(restorePath, "utf8");

// Strip SQL comments so assertions run against executable text only (comments may legally say
// "soft delete" or "never deletes").
function executable(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n")
    .toLowerCase();
}

describe("operational SQL — placement and referencing", () => {
  it("lives in runbooks/, NOT in supabase/migrations/", () => {
    expect(existsSync(verifyPath)).toBe(true);
    expect(existsSync(restorePath)).toBe(true);
    expect(existsSync(resolve(process.cwd(), "supabase/migrations/verify-source-archive.sql"))).toBe(false);
    expect(existsSync(resolve(process.cwd(), "supabase/migrations/restore-source-archive-by-runid.sql"))).toBe(false);
  });

  it("the runbook exists and references both SQL tools and the runner command", () => {
    const runbook = readFileSync(runbookPath, "utf8");
    expect(runbook).toContain("verify-source-archive.sql");
    expect(runbook).toContain("restore-source-archive-by-runid.sql");
    expect(runbook).toContain("pnpm archive:source-retention");
    expect(runbook).toContain("--apply --all --confirm-all");
  });

  it("contains no credentials or secret-looking values", () => {
    for (const text of [verifySql, restoreSql]) {
      expect(text).not.toMatch(/sb_secret|service_role|SUPABASE_SECRET|password/i);
    }
  });
});

describe("verify-source-archive.sql — strictly read-only", () => {
  const body = executable(verifySql);
  it("contains only SELECT statements — no mutation of any kind", () => {
    for (const forbidden of ["update ", "insert ", "delete ", "drop ", "truncate ", "alter ", "create "]) {
      expect(body).not.toContain(forbidden);
    }
    expect(body).toContain("select");
  });
  it("is parameterized by the mandatory :runid placeholder", () => {
    expect(verifySql).toContain(":'runid'");
  });
});

describe("restore-source-archive-by-runid.sql — gated, transactional, evidence-driven", () => {
  const body = executable(restoreSql);

  it("never deletes, drops, or truncates anything", () => {
    for (const forbidden of ["delete ", "drop ", "truncate "]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it("never updates or removes the original activity_log events (INSERT-only on activity_log)", () => {
    // the only UPDATE targets public.assets; activity_log appears only in SELECT/INSERT
    expect(body).not.toMatch(/update\s+public\.activity_log/);
    expect(body).toMatch(/insert into public\.activity_log/);
  });

  it("never touches Storage", () => {
    expect(body).not.toContain("storage.");
  });

  it("is transactional with ROLLBACK active and COMMIT requiring conscious editing", () => {
    expect(body).toMatch(/begin\s*;/);
    expect(body).toMatch(/rollback\s*;/); // active (uncommented) rollback survives comment-stripping
    expect(body).not.toMatch(/(^|\n)\s*commit\s*;/); // no ACTIVE commit — only the commented one
    expect(restoreSql).toContain("-- commit;"); // the conscious-edit path is documented
  });

  it("requires runId, restoreRunId, reason, and the confirmation token", () => {
    expect(restoreSql).toContain(":'runid'");
    expect(restoreSql).toContain(":'restore_runid'");
    expect(restoreSql).toContain(":'restore_reason'");
    expect(restoreSql).toContain("RESTORE-CONFIRMED");
    expect(body).toMatch(/:'confirm'\s*=\s*'restore-confirmed'/);
  });

  it("restores exclusively to the recorded prevLifecycle and never invents one", () => {
    expect(body).toMatch(/set\s+lifecycle\s*=\s*ev\.prev_lifecycle/);
    expect(body).toContain("prev_lifecycle in ('draft','ready_for_review','approved','rejected')");
    // no hardcoded lifecycle assignment fallback
    expect(body).not.toMatch(/set\s+lifecycle\s*=\s*'/);
  });

  it("guards owner, listing, archived state, and archived_at equality in the UPDATE", () => {
    expect(body).toMatch(/a\.owner_id\s*=\s*ev\.event_owner_id/);
    expect(body).toMatch(/a\.listing_id\s*=\s*ev\.event_listing_id/);
    expect(body).toMatch(/a\.lifecycle\s*=\s*'archived'/);
    expect(body).toMatch(/a\.archived_at\s*=\s*ev\.event_archived_at/);
  });

  it("does not recompute current or retention — no engine mirroring in the restore path", () => {
    expect(body).not.toContain("distinct on"); // no current-selection mirror
    expect(body).not.toMatch(/order by[^;]*created_at/); // no age-based asset selection
    expect(restoreSql).not.toContain("computeListingRetention");
  });
});
