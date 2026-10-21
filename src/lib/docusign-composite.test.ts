// Sobre con anexo («See Attachment»): plantilla + un documento HTML después, por composite
// templates; las pestañas van solo con la plantilla. Y la opción de ocupación como radio. Sin red.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildTemplateRoles, compositeEnvelopeBody, type CreateEnvelopeInput } from "./docusign";

const input: CreateEnvelopeInput = {
  templateId: "tpl-1",
  signerRole: "Seller",
  signerEmail: "seller@example.com",
  signerName: "Test Seller",
  clientUserId: "prop-1",
  brokerSigner: { roleName: "Broker", name: "Broker Name", email: "broker@example.com" },
  textTabs: { list_price: "650,000" },
  radioGroupTabs: { occupancy: { value: "is", locked: true } },
  attachments: [{ name: "Attachment to Listing Agreement", html: "<p>x</p>" }],
};

describe("sobre con anexo", () => {
  it("plantilla con las pestañas + documento 2 en HTML; los dos firmantes en ambos", () => {
    const roles = buildTemplateRoles(input, { textTabs: [{ tabLabel: "list_price", value: "650,000" }] });
    const body = compositeEnvelopeBody(input, roles, "Sign");
    const [ct1, ct2] = body.compositeTemplates as Array<{
      serverTemplates?: unknown;
      inlineTemplates: Array<{ recipients: { signers: Array<Record<string, unknown>> } }>;
      document?: unknown;
    }>;
    expect(ct1.serverTemplates).toEqual([{ sequence: "1", templateId: "tpl-1" }]);
    expect(ct1.inlineTemplates![0].recipients.signers.map((s) => [s.recipientId, s.roleName, "tabs" in s])).toEqual([
      ["1", "Seller", true],
      ["2", "Broker", false],
    ]);
    expect(ct2.document).toMatchObject({ documentId: "2", fileExtension: "html", documentBase64: Buffer.from("<p>x</p>").toString("base64") });
    expect(ct2.inlineTemplates[0].recipients.signers.every((s) => !("tabs" in s))).toBe(true);
  });

  describe("createEnvelopeFromTemplate", () => {
    const sent: Array<Record<string, unknown>> = [];
    beforeEach(() => {
      sent.length = 0;
      for (const [k, v] of Object.entries({ DOCUSIGN_AUTH_HOST: "a", DOCUSIGN_BASE_URI: "https://b", DOCUSIGN_ACCOUNT_ID: "c", DOCUSIGN_INTEGRATION_KEY: "d", DOCUSIGN_USER_ID: "e", DOCUSIGN_PRIVATE_KEY: "f" })) vi.stubEnv(k, v);
    });

    it("radio con valor → seleccionado y bloqueado; sin valor → no se manda (el vendedor elige)", async () => {
      vi.resetModules();
      vi.doMock("jose", () => ({
        importPKCS8: async () => ({}),
        SignJWT: class { setProtectedHeader() { return this; } setIssuer() { return this; } setSubject() { return this; } setAudience() { return this; } setIssuedAt() { return this; } setExpirationTime() { return this; } async sign() { return "jwt"; } },
      }));
      vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
        if (url.endsWith("/oauth/token")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
        sent.push(JSON.parse(init!.body!));
        return new Response(JSON.stringify({ envelopeId: "env-1", status: "sent" }));
      });
      const mod = await import("./docusign");
      await mod.createEnvelopeFromTemplate({ ...input, attachments: undefined, checkboxTabs: { lockbox_authorized: true }, lockedCheckboxTabs: ["lockbox_authorized"] });
      const tabs = (sent[0].templateRoles as Array<{ tabs?: Record<string, unknown> }>)[0].tabs!;
      expect(tabs.radioGroupTabs).toEqual([{ groupName: "occupancy", radios: [{ value: "is", selected: "true", locked: "true" }] }]);
      expect(tabs.checkboxTabs).toEqual([{ tabLabel: "lockbox_authorized", selected: "true", locked: "true" }]);

      await mod.createEnvelopeFromTemplate({ ...input, attachments: undefined, radioGroupTabs: { occupancy: { value: null, locked: false } } });
      expect((sent[1].templateRoles as Array<{ tabs?: Record<string, unknown> }>)[0].tabs).not.toHaveProperty("radioGroupTabs");

      await mod.createEnvelopeFromTemplate(input);
      expect(sent[2]).toHaveProperty("compositeTemplates");
      expect(sent[2]).not.toHaveProperty("templateRoles");
      vi.unstubAllGlobals();
    });
  });
});
