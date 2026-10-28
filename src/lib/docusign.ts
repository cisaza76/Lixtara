// DocuSign JWT-Bearer auth + REST wrapper. We deliberately skip the
// 12 MB docusign-esign SDK and call the REST API directly with fetch +
// `jose` for JWT signing.
//
// Docs:
//   https://developers.docusign.com/platform/auth/jwt/jwt-get-token/
//   https://developers.docusign.com/docs/esign-rest-api/reference/envelopes/envelopes/create/
//
// Auth flow:
//   1. Build a JWT assertion (RS256) signed with our RSA private key,
//      claiming impersonation of the integration user.
//   2. POST it to {AUTH_HOST}/oauth/token to swap for an access token.
//   3. Access tokens are valid 1 hour — we cache per process with a 50 min TTL.
//
// First-call gotcha: DocuSign requires the integration user to consent to
// the requested scopes ONCE before JWT auth works. If we get back
// `consent_required`, surface the consent URL so the user can grant it.

import { SignJWT, importPKCS8 } from "jose";
import {
  SECOND_SELLER_ROLE,
  SIGNING_DEADLINE_DAYS,
  SIGNING_REMINDER_EVERY_DAYS,
  SIGNING_REMINDER_FIRST_DAY,
} from "@/lib/listing-ownership";

const SCOPES = "signature impersonation";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not configured`);
  return v;
}

function authHost(): string {
  return env("DOCUSIGN_AUTH_HOST");
}

function baseUri(): string {
  // BASE_URI from DocuSign is like https://demo.docusign.net — REST API path
  // adds /restapi/v2.1/accounts/{account_id}/...
  return env("DOCUSIGN_BASE_URI");
}

function accountId(): string {
  return env("DOCUSIGN_ACCOUNT_ID");
}

function integrationKey(): string {
  return env("DOCUSIGN_INTEGRATION_KEY");
}

function userId(): string {
  return env("DOCUSIGN_USER_ID");
}

function privateKeyPem(): string {
  return env("DOCUSIGN_PRIVATE_KEY");
}

export function getConsentUrl(redirectUri: string): string {
  // One-time per integration: the impersonated user visits this URL and
  // approves the requested scopes. After that, JWT auth works.
  const params = new URLSearchParams({
    response_type: "code",
    scope: SCOPES,
    client_id: integrationKey(),
    redirect_uri: redirectUri,
  });
  return `https://${authHost()}/oauth/auth?${params.toString()}`;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number; // ms epoch
}
let _tokenCache: TokenCache | null = null;

export async function getAccessToken(): Promise<string> {
  if (_tokenCache && _tokenCache.expiresAt > Date.now() + 30_000) {
    return _tokenCache.accessToken;
  }

  // Convert PEM (PKCS#1 "RSA PRIVATE KEY") to PKCS#8 if needed. jose's
  // importPKCS8 requires the BEGIN PRIVATE KEY header; if the key is in
  // PKCS#1 format ("BEGIN RSA PRIVATE KEY") we wrap it.
  const pem = privateKeyPem().replace(/\\n/g, "\n").trim();
  let pkcs8 = pem;
  if (pem.includes("BEGIN RSA PRIVATE KEY")) {
    // PKCS#1 — jose can't import directly. Convert via the Node crypto
    // module which understands both formats.
    const { createPrivateKey } = await import("node:crypto");
    const key = createPrivateKey({ key: pem, format: "pem" });
    pkcs8 = key.export({ format: "pem", type: "pkcs8" }).toString();
  }
  const cryptoKey = await importPKCS8(pkcs8, "RS256");

  const jwt = await new SignJWT({ scope: SCOPES })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(integrationKey())
    .setSubject(userId())
    .setAudience(authHost())
    .setIssuedAt()
    .setExpirationTime("60m")
    .sign(cryptoKey);

  const res = await fetch(`https://${authHost()}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });

  if (!res.ok) {
    const txt = await res.text();
    if (txt.includes("consent_required")) {
      throw new Error(
        `DocuSign consent_required — visit ${getConsentUrl(
          "https://lixtara.vercel.app/api/agreement/consent-callback",
        )} once to grant impersonation, then retry.`,
      );
    }
    throw new Error(`DocuSign token exchange failed: ${res.status} ${txt}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  _tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

interface AuthedRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
}

async function authedRequest<T>(path: string, opts: AuthedRequestOptions = {}): Promise<T> {
  const token = await getAccessToken();
  const url = `${baseUri()}/restapi/v2.1/accounts/${accountId()}${path}`;
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`DocuSign ${opts.method ?? "GET"} ${path} ${res.status}: ${txt}`);
  }
  return (await res.json()) as T;
}

export interface CreateEnvelopeInput {
  templateId: string;
  /** Role name in the DocuSign template (must match exactly). */
  signerRole: string;
  signerEmail: string;
  signerName: string;
  /** Stable per-property id — required to enable embedded signing for this signer. */
  clientUserId: string;
  /** Optional tab/field substitutions for the template. */
  textTabs?: Record<string, string>;
  /** Optional checkbox tabs: tabLabel → checked. Template must bind each label. */
  checkboxTabs?: Record<string, boolean>;
  /**
   * Text-tab labels the signer must NOT edit (system-set economics like the
   * listing commission). Rendered read-only/locked on the envelope.
   */
  lockedTextTabs?: string[];
  /** Checkbox labels the signer must NOT change. */
  lockedCheckboxTabs?: string[];
  /**
   * Radio groups (one choice): groupName → selected value (null = signer picks). With
   * `locked`, every option in `options` is locked too, so the signer can't switch to another.
   */
  radioGroupTabs?: Record<string, { value: string | null; locked: boolean; options?: string[] }>;
  /**
   * Extra documents added after the template's (e.g. the "See Attachment" annex), as HTML:
   * DocuSign converts them to PDF. With any, the envelope is built with composite templates.
   */
  attachments?: Array<{ name: string; html: string }>;
  emailSubject?: string;
  /**
   * Broker de Lixtara: contrafirma DESPUÉS del vendedor (routingOrder 2) en todo acuerdo
   * (#137 f). Obligatorio: sin él DocuSign podría completar el sobre con una sola firma.
   * Nombre y email salen de src/config/brokerage.ts; el rol debe existir en la plantilla
   * como "Needs to Sign" con nombre y email vacíos (los llena el código).
   */
  brokerSigner: { roleName: string; name: string; email: string } | null;
  /**
   * Otros vendedores (#220: "Seller 2", copropietario o cónyuge por homestead). Firman por email
   * (sin clientUserId) en paralelo con el vendedor (routingOrder 1), antes que la broker. Con
   * alguno, el sobre lleva recordatorios y vence a los SIGNING_DEADLINE_DAYS días.
   */
  additionalSigners?: Array<{
    roleName: string;
    name: string;
    email: string;
    textTabs?: Record<string, string>;
    lockedTextTabs?: string[];
    /** Solo sobres TEST (scripts/docusign/test-envelopes.ts --sign-urls); el sitio no lo pone. */
    clientUserId?: string;
  }>;
}

/** Rol del broker de Lixtara en cada plantilla (#137 f; confirmar con scripts/check-docusign-template.ts). */
export const LIXTARA_BROKER_ROLE = {
  listingAgreement: "Broker",
  ca8: "Broker",
  bba1: "Seller Broker",
  asIs: "SellerBroker",
} as const;

export class MissingBrokerSignerError extends Error {
  constructor() {
    super("broker_signer_not_configured");
    this.name = "MissingBrokerSignerError";
  }
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

export class InvalidAdditionalSignerError extends Error {
  constructor() {
    super("additional_signer_invalid");
    this.name = "InvalidAdditionalSignerError";
  }
}

/**
 * Roles del sobre: vendedor (1), otros vendedores (1, en paralelo, por email) y broker de
 * Lixtara (2). Lanza ANTES de cualquier llamada a DocuSign si falta el broker o su email (ningún
 * acuerdo sale con una sola firma), o si otro vendedor no tiene un correo propio (distinto del
 * vendedor y de la broker).
 */
export function buildTemplateRoles(input: CreateEnvelopeInput, tabs: Record<string, unknown>) {
  const b = input.brokerSigner;
  if (!b || !b.roleName.trim() || !b.name.trim() || !EMAIL_RE.test(b.email)) {
    throw new MissingBrokerSignerError();
  }
  if (b.email.trim().toLowerCase() === input.signerEmail.trim().toLowerCase()) {
    // El vendedor no puede firmar también como broker.
    throw new MissingBrokerSignerError();
  }
  const taken = new Set([input.signerEmail.trim().toLowerCase(), b.email.trim().toLowerCase()]);
  const others = (input.additionalSigners ?? []).map((o) => {
    const email = o.email.trim();
    if (!o.roleName.trim() || !o.name.trim() || !EMAIL_RE.test(email) || taken.has(email.toLowerCase())) {
      throw new InvalidAdditionalSignerError();
    }
    taken.add(email.toLowerCase());
    const locked = new Set(o.lockedTextTabs ?? []);
    const text = Object.entries(o.textTabs ?? {}).map(([k, v]) =>
      locked.has(k) ? { tabLabel: k, value: v, locked: "true" } : { tabLabel: k, value: v },
    );
    return {
      email,
      name: o.name.trim(),
      roleName: o.roleName,
      routingOrder: "1",
      ...(o.clientUserId ? { clientUserId: o.clientUserId } : {}),
      ...(text.length > 0 ? { tabs: { textTabs: text } } : {}),
    };
  });
  return [
    {
      email: input.signerEmail,
      name: input.signerName,
      roleName: input.signerRole,
      clientUserId: input.clientUserId,
      routingOrder: "1",
      tabs: Object.keys(tabs).length > 0 ? tabs : undefined,
    },
    ...others,
    {
      email: b.email,
      name: b.name,
      roleName: b.roleName,
      routingOrder: "2",
    },
  ];
}

/**
 * Con otros vendedores: recordatorios de DocuSign a los SIGNING_REMINDER_FIRST_DAY días y luego
 * cada SIGNING_REMINDER_EVERY_DAYS (día 2 y día 5), y el sobre vence a los SIGNING_DEADLINE_DAYS
 * (owner, 2026-10-21). Sin ellos, la configuración de la cuenta (como hasta ahora).
 */
export function envelopeNotification(input: Pick<CreateEnvelopeInput, "additionalSigners">) {
  if (!input.additionalSigners?.length) return undefined;
  return {
    useAccountDefaults: "false",
    reminders: {
      reminderEnabled: "true",
      reminderDelay: String(SIGNING_REMINDER_FIRST_DAY),
      reminderFrequency: String(SIGNING_REMINDER_EVERY_DAYS),
    },
    expirations: { expireEnabled: "true", expireAfter: String(SIGNING_DEADLINE_DAYS), expireWarn: "1" },
  };
}

export interface CreateEnvelopeResult {
  envelopeId: string;
  status: string;
}

export async function createEnvelopeFromTemplate(
  input: CreateEnvelopeInput,
): Promise<CreateEnvelopeResult> {
  const lockedSet = new Set(input.lockedTextTabs ?? []);
  const textTabs = Object.entries(input.textTabs ?? {}).map(([k, v]) =>
    lockedSet.has(k)
      ? { tabLabel: k, value: v, locked: "true" }
      : { tabLabel: k, value: v },
  );
  // DocuSign checkbox tabs take selected as a stringified boolean.
  const lockedBoxes = new Set(input.lockedCheckboxTabs ?? []);
  const checkboxTabs = Object.entries(input.checkboxTabs ?? {}).map(([k, v]) => ({
    tabLabel: k,
    selected: v ? "true" : "false",
    ...(lockedBoxes.has(k) ? { locked: "true" } : {}),
  }));
  // A radio group with no value is left out: the template's own (unselected, required) group
  // makes the signer choose.
  const radioGroupTabs = Object.entries(input.radioGroupTabs ?? {})
    .filter(([, g]) => g.value !== null)
    .map(([groupName, g]) => ({
      groupName,
      radios: [...new Set([g.value!, ...(g.locked ? (g.options ?? []) : [])])].map((value) => ({
        value,
        selected: value === g.value ? "true" : "false",
        ...(g.locked ? { locked: "true" } : {}),
      })),
    }));

  const tabs: Record<string, unknown> = {};
  if (textTabs.length > 0) tabs.textTabs = textTabs;
  if (checkboxTabs.length > 0) tabs.checkboxTabs = checkboxTabs;
  if (radioGroupTabs.length > 0) tabs.radioGroupTabs = radioGroupTabs;

  const body = {
    templateId: input.templateId,
    status: "sent",
    emailSubject: input.emailSubject ?? "Please sign your Lixtara listing agreement",
    templateRoles: [
      {
        email: input.signerEmail,
        name: input.signerName,
        roleName: input.signerRole,
        clientUserId: input.clientUserId,
        tabs: Object.keys(tabs).length > 0 ? tabs : undefined,
      },
    ],
  };

  // Roles definitivos: vendedor (1) + broker de Lixtara (2). buildTemplateRoles lanza antes
  // de la llamada si falta la broker (#137 f).
  const roles = buildTemplateRoles(input, tabs);
  const notification = envelopeNotification(input);
  if (input.attachments?.length) {
    return authedRequest<CreateEnvelopeResult>("/envelopes", {
      method: "POST",
      body: { ...compositeEnvelopeBody(input, roles, body.emailSubject), ...(notification ? { notification } : {}) },
    });
  }
  return authedRequest<CreateEnvelopeResult>("/envelopes", {
    method: "POST",
    body: { ...body, templateRoles: roles, ...(notification ? { notification } : {}) },
  });
}

/**
 * Envelope = the server template (with the signers' tabs) + one document per attachment,
 * appended after it. Each composite template repeats the signers (DocuSign merges them by
 * recipientId); the tabs go only with the server template.
 */
export function compositeEnvelopeBody(
  input: CreateEnvelopeInput,
  roles: ReturnType<typeof buildTemplateRoles>,
  emailSubject: string,
) {
  const signers = (withTabs: boolean) =>
    roles.map((r, i) => {
      const { tabs, ...rest } = r as typeof r & { tabs?: unknown };
      return { ...rest, recipientId: String(i + 1), ...(withTabs && tabs ? { tabs } : {}) };
    });
  return {
    status: "sent",
    emailSubject,
    compositeTemplates: [
      {
        compositeTemplateId: "1",
        serverTemplates: [{ sequence: "1", templateId: input.templateId }],
        inlineTemplates: [{ sequence: "2", recipients: { signers: signers(true) } }],
      },
      ...(input.attachments ?? []).map((a, i) => ({
        compositeTemplateId: String(i + 2),
        inlineTemplates: [{ sequence: "1", recipients: { signers: signers(false) } }],
        document: {
          documentId: String(i + 2),
          name: a.name,
          fileExtension: "html",
          documentBase64: Buffer.from(a.html, "utf8").toString("base64"),
        },
      })),
    ],
  };
}

export interface RecipientViewInput {
  envelopeId: string;
  signerEmail: string;
  signerName: string;
  clientUserId: string;
  returnUrl: string;
}

export interface RecipientViewResult {
  url: string;
}

export async function getRecipientView(
  input: RecipientViewInput,
): Promise<RecipientViewResult> {
  return authedRequest<RecipientViewResult>(
    `/envelopes/${encodeURIComponent(input.envelopeId)}/views/recipient`,
    {
      method: "POST",
      body: {
        returnUrl: input.returnUrl,
        authenticationMethod: "none",
        email: input.signerEmail,
        userName: input.signerName,
        clientUserId: input.clientUserId,
      },
    },
  );
}

export interface EnvelopeStatus {
  envelopeId: string;
  status: string;
  completedDateTime?: string;
  declinedDateTime?: string;
  voidedDateTime?: string;
  voidedReason?: string;
}

export async function getEnvelopeStatus(envelopeId: string): Promise<EnvelopeStatus> {
  return authedRequest<EnvelopeStatus>(
    `/envelopes/${encodeURIComponent(envelopeId)}`,
  );
}

export interface EnvelopeSigner {
  roleName?: string;
  clientUserId?: string;
  name?: string;
  email?: string;
  status?: string;
}

/**
 * True when the SELLER has finished signing, even if the envelope is still
 * waiting for someone else (e.g. the broker's countersignature). The envelope
 * only turns "completed" when every signer is done, so its status alone kept
 * the seller stuck on "Waiting for your signature" after they had signed.
 * The seller is the embedded signer: matched by clientUserId (the property
 * id), or by the "Seller" role.
 * With a second seller ("Seller 2", #220) BOTH must have signed: the seller
 * pays only once every seller signed (owner, 2026-10-21).
 */
export function sellerHasSigned(signers: EnvelopeSigner[], clientUserId: string): boolean {
  return primarySellerHasSigned(signers, clientUserId) && secondSellersSigned(signers);
}

/**
 * Solo la firma del vendedor de la cuenta (el firmante embebido), sin mirar a "Seller 2": con dos
 * vendedores, el paso 7 deja de ofrecerle firmar en cuanto él firmó, aunque el otro falte (#220).
 */
export function primarySellerHasSigned(signers: EnvelopeSigner[], clientUserId: string): boolean {
  const seller =
    signers.find((r) => r.clientUserId === clientUserId) ??
    signers.find((r) => r.roleName?.toLowerCase() === "seller");
  return isDone(seller);
}

const isDone = (r: EnvelopeSigner | undefined) => {
  const st = r?.status?.toLowerCase();
  return st === "completed" || st === "signed";
};

/** Los otros vendedores del sobre ("Seller 2", #220): todos firmaron (true si no hay). */
export function secondSellersSigned(signers: EnvelopeSigner[]): boolean {
  return signers.filter(isSecondSeller).every(isDone);
}

/** ¿El sobre tiene otro vendedor y ya firmó? (para agreements.additional_signer_signed_at). */
export function secondSellerHasSigned(signers: EnvelopeSigner[]): boolean {
  const others = signers.filter(isSecondSeller);
  return others.length > 0 && others.every(isDone);
}

/** El segundo vendedor tal como está en el sobre (nombre y correo a los que DocuSign escribe). */
export function secondSellerOf(signers: EnvelopeSigner[]): EnvelopeSigner | null {
  return signers.find(isSecondSeller) ?? null;
}

function isSecondSeller(r: EnvelopeSigner): boolean {
  return r.roleName?.trim().toLowerCase() === SECOND_SELLER_ROLE.toLowerCase();
}

const _templateRoles = new Map<string, { roles: string[]; at: number }>();

/**
 * ¿La plantilla tiene ese rol? Un sobre con un rol que la plantilla no tiene saldría sin las
 * firmas de ese rol: con dos vendedores, el acuerdo exige "Seller 2" (plantilla v4 en adelante).
 * Caché de 10 min por proceso.
 */
export async function templateHasRole(templateId: string, role: string): Promise<boolean> {
  const hit = _templateRoles.get(templateId);
  let roles = hit && Date.now() - hit.at < 600_000 ? hit.roles : null;
  if (!roles) {
    const r = await authedRequest<{ signers?: Array<{ roleName?: string }> }>(
      `/templates/${encodeURIComponent(templateId)}/recipients`,
    );
    roles = (r.signers ?? []).map((s) => s.roleName ?? "");
    _templateRoles.set(templateId, { roles, at: Date.now() });
  }
  return roles.includes(role);
}

/**
 * True when Lixtara's broker countersigned: a signer in one of the broker roles, with the
 * broker's signing email, that is not the embedded seller and has finished. An envelope
 * that completed with the seller alone (no broker role) is NOT countersigned.
 */
export function brokerHasCountersigned(signers: EnvelopeSigner[], brokerEmail: string | null): boolean {
  if (!brokerEmail) return false;
  const roles = new Set(Object.values(LIXTARA_BROKER_ROLE).map((r) => r.toLowerCase()));
  const email = brokerEmail.trim().toLowerCase();
  return signers.some((r) => {
    const st = r.status?.toLowerCase();
    return (
      !r.clientUserId &&
      roles.has(r.roleName?.toLowerCase() ?? "") &&
      r.email?.trim().toLowerCase() === email &&
      (st === "completed" || st === "signed")
    );
  });
}

export async function getEnvelopeSigners(envelopeId: string): Promise<EnvelopeSigner[]> {
  const res = await authedRequest<{ signers?: EnvelopeSigner[] }>(
    `/envelopes/${encodeURIComponent(envelopeId)}/recipients`,
  );
  return res.signers ?? [];
}

/**
 * Anula un sobre que no terminó (plazo de firma vencido, #220). DocuSign no deja anular uno
 * completado; uno ya anulado o vencido no se vuelve a tocar (el llamador lo comprueba antes).
 */
export async function voidEnvelope(envelopeId: string, reason: string): Promise<void> {
  await authedRequest(`/envelopes/${encodeURIComponent(envelopeId)}`, {
    method: "PUT",
    body: { status: "voided", voidedReason: reason },
  });
}

/** Vuelve a mandar el correo de DocuSign a los firmantes que todavía no firmaron. */
export async function resendEnvelope(envelopeId: string): Promise<void> {
  await authedRequest(`/envelopes/${encodeURIComponent(envelopeId)}?resend_envelope=true`, {
    method: "PUT",
    body: {},
  });
}

export type AgreementStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "signed"
  | "completed"
  | "declined"
  | "voided"
  | "expired";

export function mapEnvelopeStatus(docusignStatus: string): AgreementStatus {
  // DocuSign envelope statuses:
  //   created, sent, delivered, signed, completed, declined, voided, expired
  const s = docusignStatus.toLowerCase();
  if (s === "created") return "pending";
  if (s === "sent") return "sent";
  if (s === "delivered") return "delivered";
  if (s === "signed" || s === "completed") return s as AgreementStatus;
  if (s === "declined") return "declined";
  if (s === "voided") return "voided";
  if (s === "expired") return "expired";
  return "pending";
}
