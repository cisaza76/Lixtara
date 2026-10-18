// Datos de la correduría (licencias, broker, oficina, teléfono y WhatsApp) con el enlace al
// DBPR. Los comparten /about y /owners: licencias, nombre y dirección salen de
// src/config/brokerage.ts; teléfono y WhatsApp, de src/config/contact.ts.

import type { ReactNode } from "react";
import { t, type Locale } from "@/lib/i18n";
import { BROKERAGE, DBPR_BROKERAGE_LICENSE_URL } from "@/config/brokerage";
import { CONTACT, telHref, whatsappHref } from "@/config/contact";

export function BrokerageFacts({ lang }: { lang: Locale }) {
  const copy = t(lang).aboutPage;
  const facts: { label: string; value: ReactNode }[] = [
    { label: copy.brokerageLabel, value: `${BROKERAGE.legalName} · ${copy.licenseLabel} #${BROKERAGE.brokerageLicense}` },
    { label: copy.brokerLabel, value: `${BROKERAGE.brokerName} · ${copy.licenseLabel} #${BROKERAGE.brokerLicense}` },
    { label: copy.officeLabel, value: BROKERAGE.address },
    {
      label: copy.phoneLabel,
      value: (
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          <a href={telHref()} className="underline decoration-gold-soft underline-offset-4 hover:text-gold">
            {CONTACT.phoneDisplay}
          </a>
          <a
            href={whatsappHref()}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-gold-soft underline-offset-4 hover:text-gold"
          >
            WhatsApp<span className="sr-only"> {copy.opensNewTab}</span>
          </a>
        </span>
      ),
    },
  ];

  return (
    <>
      <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6">
        {facts.map((f) => (
          <div key={f.label} className="flex flex-col gap-1 min-w-0">
            <dt className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">{f.label}</dt>
            <dd className="text-base text-ink break-words">{f.value}</dd>
          </div>
        ))}
      </dl>
      <a
        href={DBPR_BROKERAGE_LICENSE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="self-start text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/70 hover:text-gold transition-colors"
      >
        {copy.verifyDbpr} ↗<span className="sr-only"> {copy.opensNewTab}</span>
      </a>
    </>
  );
}
