"use server";

// Verificar el correo del comprador que aceptó el aviso NBR en el formulario. Se verifica al
// pulsar el botón (POST), no al abrir el enlace: los escáneres de correo abren los enlaces.
import { redirect } from "next/navigation";
import { createService } from "@/lib/supabase/service";
import { verifyEmail } from "@/lib/nbr-notice.server";

export async function verifyBuyerEmail(formData: FormData): Promise<void> {
  const lang = formData.get("lang") === "es" ? "es" : "en";
  const token = String(formData.get("token") ?? "");
  const ok = await verifyEmail(createService(), token);
  redirect(ok ? `/${lang}/showing-notice/verified` : `/${lang}/showing-notice/verify/${encodeURIComponent(token)}?error=1`);
}
