# No Brokerage Relationship notice and E-SIGN consent: texts for counsel

**Status: pending legal review.** Prepared 2026-10-29 for the brokerage's attorney.

- Notice version: `nbr-2026-10-29-pending-legal-review`
- E-SIGN consent version: `esign-2026-10-29-pending-legal-review`
- Source of truth in code: `src/lib/nbr-notice.ts`. These texts are generated from it; if they differ, the code wins and this file must be regenerated.

## Where it is used

- Florida Statutes §475.278(4) (No brokerage relationship): the duties disclosure must be given **in writing before the showing of property**.
- Buyers who say they have **no agent** or are **not sure** get it in the showing-request form on a Lixtara listing, or by a one-time email link (sent by the broker from the admin, or by the Loui assistant).
- Buyers who say they have an agent don't get it. We collect the agent's name, brokerage, email and license, and the broker coordinates the showing with the agent.
- Order on screen:
  1. E-SIGN consent checkbox;
  2. the notice, English and Spanish side by side;
  3. acceptance checkbox plus the buyer's typed full name.
- The showing can't be confirmed until the notice is accepted and the buyer's email is verified. The verification happens through the link in the email with the PDF, or through the one-time link itself.
- Evidence stored, unchangeable once accepted:
  - name, email and phone;
  - property;
  - both versions and a SHA-256 hash of the exact text shown;
  - acceptance date and time (America/New_York);
  - E-SIGN consent time;
  - IP address and user agent;
  - email verification time.
- A PDF goes to the buyer and to the broker.

## 1. Notice: English (governing)

Text of §475.278(4)(c), word for word, taken from leg.state.fl.us on 2026-10-28. "Lixtara LLC and its Associates" fills the blank "(insert name of Real Estate Entity and its Associates)". The whole notice uses the same type size, and the first sentence is uppercase and bold (§475.278(4)(b)).

**NO BROKERAGE RELATIONSHIP NOTICE**

**FLORIDA LAW REQUIRES THAT REAL ESTATE LICENSEES WHO HAVE NO BROKERAGE RELATIONSHIP WITH A POTENTIAL SELLER OR BUYER DISCLOSE THEIR DUTIES TO SELLERS AND BUYERS.**

As a real estate licensee who has no brokerage relationship with you, Lixtara LLC and its Associates owe to you the following duties:

1. Dealing honestly and fairly;
2. Disclosing all known facts that materially affect the value of residential real property which are not readily observable to the buyer.
3. Accounting for all funds entrusted to the licensee.

In the statute the form ends with "(Date) (Signature)". Here they are the acceptance timestamp and the electronic acceptance (checkbox plus typed name).

## 2. Notice: Spanish (courtesy translation, shown side by side)

Header line of the Spanish column: "Traducción de cortesía. Rige la versión en inglés."

**AVISO DE AUSENCIA DE RELACIÓN DE CORRETAJE**

**LA LEY DE FLORIDA EXIGE QUE LOS LICENCIATARIOS DE BIENES RAÍCES QUE NO TIENEN UNA RELACIÓN DE CORRETAJE CON UN POSIBLE VENDEDOR O COMPRADOR DIVULGUEN SUS DEBERES A LOS VENDEDORES Y COMPRADORES.**

Como licenciatario de bienes raíces que no tiene una relación de corretaje con usted, Lixtara LLC y sus Asociados le deben los siguientes deberes:

1. Tratar con honestidad y equidad;
2. Divulgar todos los hechos conocidos que afecten materialmente el valor de la propiedad residencial y que el comprador no pueda observar fácilmente.
3. Rendir cuentas de todos los fondos confiados al licenciatario.

## 3. E-SIGN consent (15 U.S.C. §7001(c)), shown before the notice

Title: "Consent to electronic delivery and signature" / "Consentimiento para recibir y firmar electrónicamente"

**English:**

> I agree to receive and sign the No Brokerage Relationship notice electronically (E-SIGN Act, 15 U.S.C. §7001(c)). This consent covers only this notice. You may ask for a paper copy at no charge at any time by writing to anamaria@lixtara.com or calling +1 (786) 210-3562. You may withdraw this consent at any time by the same means, at no charge; if you withdraw it before accepting the notice, we will give you the notice on paper before the showing. To update your email or phone, write to anamaria@lixtara.com. To view, sign and keep the notice you need a device with a current web browser, an email account and a program that opens PDF files, and the ability to save or print them.

**Spanish:**

> Acepto recibir y firmar electrónicamente el aviso de ausencia de relación de corretaje (Ley E-SIGN, 15 U.S.C. §7001(c)). Este consentimiento cubre solo este aviso. Puede pedir una copia en papel, sin costo, en cualquier momento, escribiendo a anamaria@lixtara.com o llamando al +1 (786) 210-3562. Puede retirar este consentimiento en cualquier momento por los mismos medios, sin costo; si lo retira antes de aceptar el aviso, se lo entregaremos en papel antes de la visita. Para actualizar su correo o teléfono, escríbanos a anamaria@lixtara.com. Para ver, firmar y guardar el aviso necesita un dispositivo con un navegador web actualizado, una cuenta de correo electrónico y un programa que abra archivos PDF, y poder guardarlos o imprimirlos.

Coverage against §7001(c)(1):

| Requirement | Where |
|---|---|
| (B)(i) right to a paper copy; right to withdraw consent, with its conditions and consequences | sentences 3–4 |
| (B)(ii) scope: this notice only | sentence 2 |
| (B)(iii) how to withdraw and how to update contact information | sentences 4–5 |
| (B)(iv) how to get a paper copy, and whether there is a fee | sentence 3 (no charge) |
| (C)(i) hardware and software requirements | last sentence |
| (C)(ii) consent given in a way that reasonably shows the buyer can access the record | given on the same screen where the notice is read; the PDF is emailed |

## 4. Acceptance (checkbox, with the typed full name as the signature)

- EN: "I have read the No Brokerage Relationship notice and I accept it. My full name and checking this box are my electronic signature."
- ES: "Leí el aviso de ausencia de relación de corretaje (No Brokerage Relationship) y lo acepto. Mi nombre completo y marcar esta casilla son mi firma electrónica."

## 5. Statement on the buyer relationship (site, listings, emails, Loui)

- EN: "Lixtara represents the seller. If you do not have an agent, we can show you the property and receive your offer, but we do not represent you and will not advise you in negotiating against the seller. We recommend consulting your own agent or attorney."
- ES: "Lixtara representa al vendedor. Si usted no tiene agente, podemos mostrarle la propiedad y recibir su oferta, pero no lo representamos: no le daremos asesoría para negociar contra el vendedor. Le recomendamos consultar a su propio agente o abogado."

"Not sure" line added to the showing confirmation:

- EN: "If you have an agreement with an agent, let us know so we can coordinate the showing with them."
- ES: "Si tiene un acuerdo con un agente, avísenos para coordinar la visita con él."

## Questions for counsel

1. Is the typed name plus checkbox an acceptable "(Signature)" for the §475.278(4)(c) form? Is the acceptance timestamp an acceptable "(Date)"?
2. Is the Spanish courtesy translation accurate? Is the "English governs" line enough?
3. Is the E-SIGN consent wording sufficient under §7001(c)? We assume no fee for paper copies and paper delivery before the showing if consent is withdrawn.
4. Is it right to treat a buyer who is "not sure" whether they have an agent as having no agent (NBR notice), with the line asking them to tell us?
5. Represented buyer on a Lixtara listing: is recording "agreement not required: buyer represented by their own agent (seller side only)" an acceptable basis to confirm the showing? And is "all communication goes through the agent" correct?
6. Showings of other brokerages' MLS listings are turned off for launch. What disclosure and agreement would they need in phase 2?
7. The Terms of Use still mention a "buyer agreement" (src/lib/legal/terms.ts §2 and the disputes clause), and the Notices page §2.1 names only the listing agreement. Should they be updated to say that unrepresented buyers get the NBR notice?
