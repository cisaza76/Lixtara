// Guard de producción: con DocuSign en Demo, un listing real no recibe sobre en Production.
import { describe, it, expect } from "vitest";
import { blocksRealAgreement, docusignIsProduction } from "./docusign-demo-guard";

const env = (VERCEL_ENV: string | undefined, DOCUSIGN_AUTH_HOST: string | undefined) =>
  ({ VERCEL_ENV, DOCUSIGN_AUTH_HOST }) as unknown as NodeJS.ProcessEnv;

describe("blocksRealAgreement", () => {
  it("Production + Demo + listing real → bloquea", () => {
    expect(blocksRealAgreement({ isTest: false, env: env("production", "account-d.docusign.com") })).toBe(true);
  });

  it("Production + Demo + listing is_test → sigue", () => {
    expect(blocksRealAgreement({ isTest: true, env: env("production", "account-d.docusign.com") })).toBe(false);
  });

  it("Production + DocuSign de producción → sigue (real o is_test)", () => {
    expect(blocksRealAgreement({ isTest: false, env: env("production", "account.docusign.com") })).toBe(false);
    expect(blocksRealAgreement({ isTest: false, env: env("production", " Account.DocuSign.com ") })).toBe(false);
    expect(blocksRealAgreement({ isTest: true, env: env("production", "account.docusign.com") })).toBe(false);
  });

  it("Production sin DOCUSIGN_AUTH_HOST, u otro host → bloquea (fail-closed)", () => {
    expect(blocksRealAgreement({ isTest: false, env: env("production", undefined) })).toBe(true);
    expect(blocksRealAgreement({ isTest: false, env: env("production", "account-d.docusign.com.evil") })).toBe(true);
  });

  it("Preview, Development y local → nunca bloquea", () => {
    for (const v of ["preview", "development", undefined]) {
      expect(blocksRealAgreement({ isTest: false, env: env(v, "account-d.docusign.com") })).toBe(false);
    }
  });

  it("docusignIsProduction: solo account.docusign.com", () => {
    expect(docusignIsProduction(env("production", "account.docusign.com"))).toBe(true);
    expect(docusignIsProduction(env("production", "account-d.docusign.com"))).toBe(false);
  });
});
