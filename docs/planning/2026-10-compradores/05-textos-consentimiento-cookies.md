# Annex · Analytics consent texts for counsel review

**Status:** draft. The code is built but **off**: these texts appear only once the owner sets the analytics accounts (GA4 via Google Tag Manager, and PostHog). Until then the site shows the current informational cookie notice and the current Cookie Policy.

**Source of truth in code:** `src/lib/i18n.ts` (`cookieNotice`) and `src/lib/legal/cookies.ts` (`ANALYTICS_REPLACEMENTS`). Any change you request will be made there.

## How it works (facts to review against the text)
- **No loading before a choice.** Nothing analytics-related loads until the visitor chooses. "Accept analytics" and "Reject" have the same size and style.
- **Reject or withdraw.** Rejecting, or later withdrawing through "Cookie settings" in the footer, deletes the analytics cookies (`_ga*`, `ph_*`) and PostHog's local storage, and nothing loads.
- **Google tools run with Consent Mode v2.** Advertising storage, ad user data and ad personalization are always denied. Only analytics storage is granted, and only after "Accept".
- **What is collected.** Page addresses without query parameters. No session recording, no automatic capture of clicks or typed text, no page titles. Events carry only closed-list values (for example "which filters were used"). Nothing carries names, emails, phone numbers, MLS listing content or contract details.
- **Business events stay internal.** Lead created, agreement recorded, plan purchased and listing published are kept only in our own server logs. They are not sent to Google or PostHog.
- **Staff admin panel.** Analytics never runs there.
- **The choice expires after 12 months.**

## 1. Consent banner

| | EN | ES |
|---|---|---|
| Message | We use essential cookies to run the site. With your permission, we also use analytics cookies (Google Analytics and PostHog) to understand how the site is used. No advertising cookies. | Usamos cookies esenciales para que el sitio funcione. Con tu permiso, también usamos cookies de analítica (Google Analytics y PostHog) para entender cómo se usa el sitio. Sin cookies de publicidad. |
| Link | Cookie Policy | Política de Cookies |
| Buttons (equal weight) | Reject · Accept analytics | Rechazar · Aceptar analítica |
| Footer link | Cookie settings | Configurar cookies |

## 2. Cookie Policy: paragraphs that change when analytics is on (EN)

| Section | Current text (analytics off) | Text with analytics on |
|---|---|---|
| Intro | Any future use of non-essential cookies will be subject to the consent process described in this policy. | Non-essential analytics cookies are used only if you accept them through the consent banner described in this policy. |
| 2. How We Use Cookies | We do not currently use cookies for advertising, and we do not currently run product or marketing analytics that rely on cookies. | We do not use cookies for advertising. With your consent, we use analytics cookies to understand how the site is used, as described in Section 3.4. |
| 3.4 Analytics & Performance | We do not currently use analytics or performance cookies. If, in the future, we add privacy-respecting product or marketing analytics, this policy will be updated and, where required by applicable law, we will obtain your consent before such non-essential cookies are set. | Only if you accept analytics in the consent banner, we use Google Analytics 4 (loaded through Google Tag Manager) to measure traffic sources and campaigns, and PostHog to understand how visitors use our search and listing flows. We configure them to collect page addresses without query parameters, do not record sessions, do not capture the text you type, and do not use them for advertising. If you reject analytics, these tools are not loaded. |
| 3.4 bullet 1 | Not currently in use. | Google Analytics 4 / Google Tag Manager (cookies such as _ga), only with your consent. |
| 3.4 bullet 2 | Any future use will be disclosed here and, where required, consent-based. | PostHog (cookies and local storage such as ph_*), only with your consent. You can change your choice at any time through "Cookie settings" in the site footer. |
| 7. Consent | When you first visit Lixtara, we show a lightweight cookie notice that informs you about our use of cookies and points you to this policy. | When you first visit Lixtara, we show a cookie banner that lets you accept or reject analytics cookies, with both options equally available, and points you to this policy. |
| 7. Consent | If we introduce non-essential cookies in the future (for example, analytics), we will request your consent where required by applicable privacy and ePrivacy laws before those cookies are set, and you will be able to make a choice through the cookie notice. | Analytics cookies are set only after you accept them. If you reject them, or later withdraw your consent through "Cookie settings", the analytics tools are not loaded and their cookies are deleted from your browser. |

The Spanish policy changes the same paragraphs with equivalent text (`ANALYTICS_REPLACEMENTS.es`).

## 3. Questions for counsel
1. Is the banner wording sufficient, and should it name the providers' privacy policies or the data transfer to the US providers?
2. Does the Privacy Policy need a matching analytics section (providers, purpose, retention, opt-out)?
3. Is a 12-month consent duration appropriate?
4. Is anything required for EU/UK visitors beyond opt-in (for example, a provider list with links)?
