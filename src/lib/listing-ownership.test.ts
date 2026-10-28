// #220: titular del listing y segundo firmante vendedor. Reglas del owner (2026-10-21 y
// 2026-10-27): (a) la creación del acuerdo valida sellers_required = 1 + firmantes guardados
// (inserta con service_role, sin la política de la base); (b) dos en el título + homestead de un
// casado = 3 firmantes → revisión manual; (c) otro en el título u homestead sin segundo firmante:
// el paso 3 no avanza y el acuerdo se rechaza; el segundo firmante necesita su propio correo.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  agreementSellerNames,
  agreementSignerFields,
  isOwnershipError,
  notSellerEmailPattern,
  OWNERSHIP_ERROR_COPY,
  OWNERSHIP_ERROR_FIELD,
  ownershipFormInitial,
  ownershipStepComplete,
  parseOwnershipForm,
  signerPlan,
  SIGNING_DEADLINE_DAYS,
  type StoredOwnership,
} from "@/lib/listing-ownership";
import { t } from "@/lib/i18n";
import { listingErrorField } from "@/lib/analytics";

const NOW = new Date("2026-10-27T15:00:00Z");
const SELLER_EMAIL = "Ana.Perez+home@Example.com";
const form = (fields: Record<string, string>) => (name: string) => fields[name] ?? null;
const parse = (fields: Record<string, string>) => parseOwnershipForm(form(fields), SELLER_EMAIL, NOW);
const signer = { signer_full_name: "Luis Pérez", signer_email: "luis@example.com", signer_permission: "1" };
const individuals = (title: "yes" | "no", homestead: "yes" | "no", extra: Record<string, string> = {}) =>
  parse({ owner_kind: "individuals", other_title_holders: title, married_homestead: homestead, ...extra });

describe("parseOwnershipForm: paso 3", () => {
  it("una persona, sin otro en el título ni homestead de casado → un firmante", () => {
    const r = individuals("no", "no", signer);
    expect(r).toEqual({
      ok: true,
      ownership: { owner_kind: "individuals", other_title_holders: false, married_homestead: false, entity_name: null, entity_signer_title: null, entity_authority_confirmed_at: null, manual_review_reason: null },
      signer: null,
    });
  });

  it("(c) otro en el título sin segundo firmante → no avanza", () => {
    expect(individuals("yes", "no")).toEqual({ ok: false, error: "signer_name_required" });
  });
  it("(c) homestead de un casado sin segundo firmante → no avanza", () => {
    expect(individuals("no", "yes")).toEqual({ ok: false, error: "signer_name_required" });
  });

  it("otro en el título → firma como titular; homestead → como cónyuge", () => {
    const a = individuals("yes", "no", signer);
    const b = individuals("no", "yes", signer);
    expect(a.ok && a.signer).toEqual({ relationship: "title_holder", full_name: "Luis Pérez", email: "luis@example.com", permission_confirmed_at: NOW.toISOString() });
    expect(b.ok && b.signer?.relationship).toBe("homestead_spouse");
  });

  it("(b) dos en el título + homestead, y el otro titular NO es el cónyuge → 3 firmantes: revisión manual", () => {
    const r = individuals("yes", "yes", { co_owner_is_spouse: "no", ...signer });
    expect(r.ok && r.ownership).toMatchObject({ owner_kind: "manual_review", manual_review_reason: "three_or_more_owners", other_title_holders: true, married_homestead: true });
    expect(r.ok && r.signer).toBeNull();
  });
  it("dos en el título + homestead, y el otro titular ES el cónyuge → dos firmantes", () => {
    const r = individuals("yes", "yes", { co_owner_is_spouse: "yes", ...signer });
    expect(r.ok && r.ownership.owner_kind).toBe("individuals");
    expect(r.ok && r.signer?.relationship).toBe("title_holder");
  });
  it("con los dos sí hay que contestar si el otro titular es el cónyuge", () => {
    expect(individuals("yes", "yes", signer)).toEqual({ ok: false, error: "spouse_answer_required" });
  });

  it("el segundo firmante necesita su propio correo (sin importar mayúsculas ni espacios)", () => {
    for (const email of [SELLER_EMAIL, " ana.perez+HOME@example.com ", "ANA.PEREZ+HOME@EXAMPLE.COM"]) {
      expect(individuals("yes", "no", { ...signer, signer_email: email })).toEqual({ ok: false, error: "signer_same_email" });
    }
  });
  it("correo inválido, nombre corto o sin la casilla de permiso → error del campo", () => {
    expect(individuals("yes", "no", { ...signer, signer_email: "luis-at-example" })).toEqual({ ok: false, error: "signer_email_invalid" });
    expect(individuals("yes", "no", { ...signer, signer_full_name: "L" })).toEqual({ ok: false, error: "signer_name_required" });
    expect(individuals("yes", "no", { ...signer, signer_permission: "" })).toEqual({ ok: false, error: "signer_permission_required" });
  });
  it("sin respuestas → error de cada pregunta", () => {
    expect(parse({})).toEqual({ ok: false, error: "owner_kind_required" });
    expect(parse({ owner_kind: "individuals" })).toEqual({ ok: false, error: "title_answer_required" });
    expect(parse({ owner_kind: "individuals", other_title_holders: "no" })).toEqual({ ok: false, error: "homestead_answer_required" });
  });

  it("LLC de Florida: nombre, cargo y autoridad; un firmante", () => {
    const ok = parse({ owner_kind: "fl_entity", entity_name: "Sunset Holdings LLC", entity_signer_title: "Managing Member", entity_authority: "1", ...signer });
    expect(ok.ok && ok.ownership).toMatchObject({ owner_kind: "fl_entity", entity_name: "Sunset Holdings LLC", entity_signer_title: "Managing Member", entity_authority_confirmed_at: NOW.toISOString() });
    expect(ok.ok && ok.signer).toBeNull();
    expect(parse({ owner_kind: "fl_entity", entity_signer_title: "MM", entity_authority: "1" })).toEqual({ ok: false, error: "entity_name_required" });
    expect(parse({ owner_kind: "fl_entity", entity_name: "Sunset Holdings LLC", entity_authority: "1" })).toEqual({ ok: false, error: "entity_title_required" });
    expect(parse({ owner_kind: "fl_entity", entity_name: "Sunset Holdings LLC", entity_signer_title: "Managing Member" })).toEqual({ ok: false, error: "entity_authority_required" });
  });

  it("revisión manual: trust, sucesión, empresa de otro estado, 3+ dueños, poder", () => {
    for (const reason of ["non_fl_entity", "trust", "estate", "three_or_more_owners", "poa"]) {
      const r = parse({ owner_kind: "manual_review", manual_review_reason: reason });
      expect(r.ok && r.ownership).toMatchObject({ owner_kind: "manual_review", manual_review_reason: reason });
    }
    expect(parse({ owner_kind: "manual_review" })).toEqual({ ok: false, error: "manual_review_reason_required" });
  });
});

const stored = (o: Partial<StoredOwnership>): StoredOwnership => ({
  owner_kind: "individuals",
  other_title_holders: false,
  married_homestead: false,
  manual_review_reason: null,
  manual_review_cleared_at: null,
  ...o,
});
const luis = { full_name: "Luis Pérez", email: "luis@example.com", relationship: "title_holder" };

describe("signerPlan: quién firma el acuerdo (lo usa /api/agreement/create)", () => {
  it("sin titular guardado → el acuerdo no se crea", () => {
    expect(signerPlan(null, [], SELLER_EMAIL)).toEqual({ ok: false, error: "ownership_missing" });
  });
  it("un vendedor", () => {
    expect(signerPlan(stored({}), [], SELLER_EMAIL)).toEqual({ ok: true, sellersRequired: 1, signer: null });
  });
  it("(c) otro en el título u homestead sin firmante guardado → rechazo", () => {
    expect(signerPlan(stored({ other_title_holders: true }), [], SELLER_EMAIL)).toEqual({ ok: false, error: "signer_required" });
    expect(signerPlan(stored({ married_homestead: true }), [], SELLER_EMAIL)).toEqual({ ok: false, error: "signer_required" });
  });
  it("dos vendedores", () => {
    expect(signerPlan(stored({ other_title_holders: true }), [luis], SELLER_EMAIL)).toEqual({ ok: true, sellersRequired: 2, signer: luis });
  });
  it("el correo del segundo firmante igual al de la cuenta (registrada después del paso 3) → rechazo", () => {
    expect(signerPlan(stored({ other_title_holders: true }), [{ ...luis, email: "ANA.perez+home@example.com" }], SELLER_EMAIL)).toEqual({ ok: false, error: "signer_same_email" });
  });
  it("revisión manual sin destrabar → no hay acuerdo automático; destrabada → un firmante", () => {
    expect(signerPlan(stored({ owner_kind: "manual_review", manual_review_reason: "trust" }), [], SELLER_EMAIL)).toEqual({ ok: false, error: "manual_review" });
    expect(signerPlan(stored({ owner_kind: "manual_review", manual_review_reason: "trust", manual_review_cleared_at: NOW.toISOString() }), [], SELLER_EMAIL)).toEqual({ ok: true, sellersRequired: 1, signer: null });
  });
  it("LLC: un firmante", () => {
    expect(signerPlan(stored({ owner_kind: "fl_entity" }), [], SELLER_EMAIL)).toEqual({ ok: true, sellersRequired: 1, signer: null });
  });
});

describe("(a) agreementSignerFields: sellers_required = 1 + firmantes guardados, en código", () => {
  it("dos vendedores con un firmante guardado → 2 y plazo de 7 días", () => {
    const plan = signerPlan(stored({ other_title_holders: true }), [luis], SELLER_EMAIL);
    if (!plan.ok) throw new Error("plan");
    const r = agreementSignerFields(plan, 1, NOW);
    expect(r).toEqual({
      ok: true,
      fields: { sellers_required: 2, signing_deadline_at: new Date(NOW.getTime() + SIGNING_DEADLINE_DAYS * 86_400_000).toISOString() },
    });
    expect(SIGNING_DEADLINE_DAYS).toBe(7);
  });
  it("un vendedor sin firmantes → 1, sin plazo", () => {
    const plan = signerPlan(stored({}), [], SELLER_EMAIL);
    if (!plan.ok) throw new Error("plan");
    expect(agreementSignerFields(plan, 0, NOW)).toEqual({ ok: true, fields: { sellers_required: 1, signing_deadline_at: null } });
  });
  it("un firmante guardado que ya no corresponde (contestó que no) → desajuste: no se crea", () => {
    const plan = signerPlan(stored({}), [luis], SELLER_EMAIL);
    if (!plan.ok) throw new Error("plan");
    expect(plan.sellersRequired).toBe(1);
    expect(agreementSignerFields(plan, 1, NOW)).toEqual({ ok: false });
  });
});

describe("completitud del paso 3", () => {
  it("sin titular, o con otro en el título y sin firmante → incompleto", () => {
    expect(ownershipStepComplete(null, [])).toBe(false);
    expect(ownershipStepComplete(stored({ other_title_holders: true }), [])).toBe(false);
  });
  it("completo: un vendedor, dos con firmante, LLC, y revisión manual con motivo", () => {
    expect(ownershipStepComplete(stored({}), [])).toBe(true);
    expect(ownershipStepComplete(stored({ married_homestead: true }), [luis])).toBe(true);
    expect(ownershipStepComplete(stored({ owner_kind: "fl_entity" }), [])).toBe(true);
    expect(ownershipStepComplete(stored({ owner_kind: "manual_review", manual_review_reason: "estate" }), [])).toBe(true);
  });
});

describe("el correo repetido en el navegador (pattern) y en los textos", () => {
  const browser = (pattern: string) => (v: string) => new RegExp(`^(?:${pattern})$`, "v").test(v);
  it("rechaza el correo del vendedor en cualquier combinación de mayúsculas y con espacios", () => {
    const ok = browser(notSellerEmailPattern(SELLER_EMAIL)!);
    for (const v of [SELLER_EMAIL, "ana.perez+home@example.com", " ANA.PEREZ+HOME@EXAMPLE.COM "]) expect(ok(v), v).toBe(false);
    for (const v of ["luis@example.com", "ana.perez@example.com", "ana.perezxhome@example.com", "ana.perez+home@example.co"]) expect(ok(v), v).toBe(true);
  });
  it("sin correo del vendedor (sesión anónima) no hay patrón", () => {
    expect(notSellerEmailPattern(null)).toBeUndefined();
  });
  it('"Cada firmante necesita su propio correo para firmar el acuerdo" (EN/ES)', () => {
    expect(t("es").listingForm.stepErrors.signerSameEmail).toBe("Cada firmante necesita su propio correo para firmar el acuerdo.");
    expect(t("en").listingForm.stepErrors.signerSameEmail).toBe("Each signer needs their own email to sign the agreement.");
  });
  it("cada error tiene texto EN/ES y campo para la analítica", () => {
    for (const [code, key] of Object.entries(OWNERSHIP_ERROR_COPY)) {
      expect(isOwnershipError(code)).toBe(true);
      for (const lang of ["en", "es"] as const) {
        expect((t(lang).listingForm.stepErrors as Record<string, string>)[key], `${lang}.${key}`).toBeTruthy();
        expect((t(lang).listingForm.fieldErrors as Record<string, string>)[OWNERSHIP_ERROR_FIELD[code as keyof typeof OWNERSHIP_ERROR_FIELD]], `${lang}.${code}`).toBeTruthy();
      }
      expect(listingErrorField(code)).toBe(OWNERSHIP_ERROR_FIELD[code as keyof typeof OWNERSHIP_ERROR_FIELD]);
    }
    expect(isOwnershipError("save_failed")).toBe(false);
  });
});

describe("valores iniciales y L2", () => {
  it("tres firmantes guardados como revisión manual vuelven a mostrar las preguntas", () => {
    const i = ownershipFormInitial(stored({ owner_kind: "manual_review", manual_review_reason: "three_or_more_owners", other_title_holders: true, married_homestead: true }), null);
    expect(i).toMatchObject({ kind: "individuals", otherOnTitle: "yes", homestead: "yes", coOwnerIsSpouse: "no" });
  });
  it("dos firmantes con los dos sí → el otro titular es el cónyuge", () => {
    const i = ownershipFormInitial(stored({ other_title_holders: true, married_homestead: true }), { ...luis, permission_confirmed_at: NOW.toISOString() });
    expect(i).toMatchObject({ kind: "individuals", coOwnerIsSpouse: "yes", signerName: "Luis Pérez", signerEmail: "luis@example.com", signerPermission: true });
  });
  it("sin nada guardado → vacío", () => {
    expect(ownershipFormInitial(null, null)).toMatchObject({ kind: "", otherOnTitle: "", homestead: "" });
  });
  it("L2 lleva los dos nombres", () => {
    expect(agreementSellerNames("Ana Pérez", luis)).toBe("Ana Pérez and Luis Pérez");
    expect(agreementSellerNames("Ana Pérez", null)).toBe("Ana Pérez");
  });
});

describe("el paso 3, la creación del acuerdo y el paso 7 usan estas reglas", () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const page = src("src/app/[lang]/listing/new/page.tsx");
  const route = src("src/app/api/agreement/create/route.ts");

  it("paso 3: lee el formulario, guarda titular y firmante con la sesión, y borra el firmante que ya no corresponde", () => {
    expect(page).toContain("parseOwnershipForm((n) => formData.get(n), user.email ?? null, new Date())");
    expect(page).toContain('.from("listing_ownership")\n      .upsert(');
    expect(page).toContain('await supabase.from("listing_additional_signers").delete().eq("property_id", id)');
    expect(page).toContain("error=signer_same_email");
    expect(page).toMatch(/<OwnershipSection\s+initial=\{ownershipFormInitial\(ownership, additionalSigner\)\}\s+sellerEmail=\{sessionUser\?\.email \?\? null\}/);
    expect(page).toContain("signer_email: copy.stepErrors.signerSameEmail,");
  });

  it("(a) el acuerdo valida en código quién firma antes de armar el sobre (inserta con service_role)", () => {
    expect(route).toContain("const plan = signerPlan(owners.ownership, owners.signers, user.email);");
    expect(route).toContain("const signerFields = agreementSignerFields(plan, owners.signers.length, new Date());");
    expect(route).toContain("...signerFields.fields,");
    expect(route).toMatch(/plan\.error === "manual_review"[\s\S]{0,120}status: 409/);
    expect(route.indexOf("agreementSignerFields(")).toBeLessThan(route.indexOf("createEnvelopeFromTemplate({"));
    expect(route).toContain("templateHasRole(templateId, SECOND_SELLER_ROLE)");
    expect(route).toContain("InvalidAdditionalSignerError");
  });

  it("paso 7: revisión manual sin botón; con dos vendedores, 'Esperando la firma de {nombre}'", () => {
    expect(page).toContain('ownership?.owner_kind === "manual_review" && !ownership.manual_review_cleared_at');
    expect(page).toContain("copy.step7.waitingCosignerTitle.replace(\"{name}\", waitingCosigner.full_name)");
    expect(t("es").listingForm.step7.waitingCosignerTitle).toBe("Esperando la firma de {name}.");
  });
});
