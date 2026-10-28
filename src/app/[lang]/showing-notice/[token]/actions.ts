"use server";

// Aceptar el aviso NBR desde el enlace (F.S. 475.278(4)). El token viaja en el formulario,
// nunca datos personales en la URL. La evidencia: lo que el comprador escribe aquí, la
// versión y el hash del texto, la hora, la IP y el user agent.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createService } from "@/lib/supabase/service";
import { normalizePhone } from "@/lib/buyer-leads";
import { acceptFromLink, findOpenNotice, requestEvidence } from "@/lib/nbr-notice.server";

export async function acceptNbrNotice(formData: FormData): Promise<void> {
  const lang = formData.get("lang") === "es" ? "es" : "en";
  const token = String(formData.get("token") ?? "");
  const base = `/${lang}/showing-notice/${encodeURIComponent(token)}`;
  const fullName = String(formData.get("full_name") ?? "").trim();
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  if (formData.get("nbr_accept") !== "on") redirect(`${base}?error=nbr`);
  if (!fullName || fullName.length > 120) redirect(`${base}?error=name`);
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;

  const svc = createService();
  const notice = await findOpenNotice(svc, token);
  if (!notice || !notice.email) redirect(`${base}?error=expired`);

  const ok = await acceptFromLink(svc, notice.id, {
    fullName,
    email: notice.email,
    phone,
    listingLabel: notice.listing_label,
    lang,
    ...requestEvidence(await headers()),
  });
  redirect(ok ? `/${lang}/showing-notice/accepted` : `${base}?error=expired`);
}
