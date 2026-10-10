import { describe, it, expect } from "vitest";
import { escapeHtml, parseContactForm } from "@/lib/contact-form";
import { whatsappHref, telHref } from "@/config/contact";

const form = (o: Record<string, string>) => (k: string) => o[k];

describe("parseContactForm", () => {
  const valid = { name: " Ana ", email: "Ana@Example.com", phone: "", topic: "sell", message: "Hola" };

  it("accepts a valid message and normalizes it", () => {
    expect(parseContactForm(form(valid))).toEqual({
      ok: true,
      data: { name: "Ana", email: "ana@example.com", phone: "", topic: "sell", message: "Hola" },
    });
  });

  it("rejects missing fields, bad email and the honeypot", () => {
    expect(parseContactForm(form({ ...valid, message: " " }))).toEqual({ ok: false, error: "required" });
    expect(parseContactForm(form({ ...valid, email: "nope" }))).toEqual({ ok: false, error: "email" });
    expect(parseContactForm(form({ ...valid, website: "x" }))).toEqual({ ok: false, error: "spam" });
    expect(parseContactForm(form({ ...valid, message: "a".repeat(4001) }))).toEqual({ ok: false, error: "too_long" });
  });

  it("falls back to 'other' for an unknown topic", () => {
    const r = parseContactForm(form({ ...valid, topic: "hack" }));
    expect(r.ok && r.data.topic).toBe("other");
  });
});

describe("contact helpers", () => {
  it("escapes HTML", () => {
    expect(escapeHtml(`<b onclick="x">'&'</b>`)).toBe("&lt;b onclick=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/b&gt;");
  });

  it("builds tel and WhatsApp links", () => {
    expect(telHref()).toBe("tel:+17862103562");
    expect(whatsappHref()).toBe("https://wa.me/17862103562");
    expect(whatsappHref("Hola Lixtara")).toBe("https://wa.me/17862103562?text=Hola%20Lixtara");
  });
});
