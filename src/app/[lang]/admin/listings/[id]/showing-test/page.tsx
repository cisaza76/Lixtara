// Prueba de la solicitud de visita en producción con un listado de prueba (CLAUDE.md "Test
// data"). La ficha pública nunca muestra un listado `is_test` (el proxy responde 404), así que
// el staff prueba aquí el MISMO formulario (ShowingRequestForm → /api/showing-requests). Solo
// listados `is_test`; la ruta los acepta solo al staff y los marca [TEST].
import { notFound } from "next/navigation";
import { isLocale, t } from "@/lib/i18n";
import { assertStaff } from "@/lib/admin-auth";
import { fillBrokerageCopy } from "@/config/brokerage";
import { ShowingRequestForm } from "@/components/showing-request-form";
import { getStaffTestProperty } from "@/lib/staff-test-listing.server";

export const dynamic = "force-dynamic";

export default async function ShowingTestPage({ params }: { params: Promise<{ lang: string; id: string }> }) {
  const { lang, id } = await params;
  if (!isLocale(lang)) notFound();
  await assertStaff(lang);
  const property = await getStaffTestProperty(id);
  if (!property) notFound();

  const copy = t(lang).showingRequest;
  const labels = {
    ...copy,
    intro: fillBrokerageCopy(copy.intro),
    successBody: fillBrokerageCopy(copy.successBody),
    withAgentBody: fillBrokerageCopy(copy.withAgentBody),
  };
  const es = lang === "es";
  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <p data-test-listing-preview className="border border-red-300 bg-red-50 px-4 py-2 text-xs text-red-800">
        {es
          ? "LISTADO DE PRUEBA (is_test). Usa datos inventados (@example.com). No es público."
          : "TEST LISTING (is_test). Use made-up data (@example.com). Not public."}
      </p>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl text-ink font-normal">
          {es ? "Prueba: solicitar visita" : "Test: request a showing"}
        </h1>
        <p className="text-sm text-ink/70">
          {property.address_street}, {property.address_city}, {property.address_state} {property.address_zip}
        </p>
      </div>
      <ShowingRequestForm target={{ propertyId: property.id }} lang={lang} labels={labels} />
    </div>
  );
}
