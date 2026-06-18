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
  emailSubject?: string;
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
  const checkboxTabs = Object.entries(input.checkboxTabs ?? {}).map(
    ([k, v]) => ({ tabLabel: k, selected: v ? "true" : "false" }),
  );

  const tabs: Record<string, unknown> = {};
  if (textTabs.length > 0) tabs.textTabs = textTabs;
  if (checkboxTabs.length > 0) tabs.checkboxTabs = checkboxTabs;

  const body = {
    templateId: input.templateId,
    status: "sent",
    emailSubject: input.emailSubject ?? "Lixtara listing agreement — please sign",
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

  return authedRequest<CreateEnvelopeResult>("/envelopes", {
    method: "POST",
    body,
  });
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
