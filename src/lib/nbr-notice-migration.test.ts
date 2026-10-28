// Migración 20261029120000 (aviso NBR) y su uso: segura para pegar, evidencia protegida,
// "sin aviso no hay visita" en la base, y las pantallas que lo comprueban antes.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOUI_SYSTEM_PROMPT } from "@/lib/loui-prompt";

const raw = readFileSync("supabase/migrations/20261029120000_buyer_nbr_notice.sql", "utf8");
const sql = raw.replace(/--.*$/gm, "");

describe("migración del aviso NBR", () => {
  it("sin $$ ni corchetes fuera de comentarios (se pega en el SQL Editor) y con rollback", () => {
    expect(sql).not.toMatch(/[$[]/);
    expect(raw).toContain("-- ── ROLLBACK");
    expect(raw).toContain("-- drop table if exists public.buyer_nbr_notices;");
  });

  it("RLS activa, solo lectura de staff, sin políticas de escritura", () => {
    expect(sql).toContain("alter table public.buyer_nbr_notices enable row level security;");
    expect(sql).toMatch(/create policy "buyer nbr notices staff read" on public\.buyer_nbr_notices for select\s+using \(public\.is_admin_or_broker\(\)\)/);
    expect(sql).not.toMatch(/on public\.buyer_nbr_notices for (insert|update|delete|all)/);
  });

  it("la aceptación exige la evidencia y, aceptada, no se cambia ni se borra", () => {
    expect(sql).toMatch(/accepted_at is null\s+or \(full_name is not null and email is not null and lang is not null\s+and ip is not null and user_agent is not null and notice_text_sha256 is not null\)/);
    expect(sql).toContain("An accepted NBR notice cannot be deleted.");
    expect(sql).toContain("An accepted NBR notice cannot be changed.");
    expect(sql).toContain("before update or delete on public.buyer_nbr_notices");
  });

  it("la base no deja confirmar la visita sin aviso (o sin los datos del agente), en las dos tablas", () => {
    expect(sql).toContain("before insert or update on public.buyer_leads\n  for each row execute function public.guard_showing_nbr();");
    expect(sql).toContain("before insert or update on public.schedule_requests\n  for each row execute function public.guard_showing_nbr();");
    // El admin reconoce el motivo por el principio del mensaje (dbNbrReason).
    expect(sql).toContain("raise exception ''nbr_notice_missing:");
    expect(sql).toContain("raise exception ''nbr_buyer_agent_missing:");
    // El comprador no programa su propia visita.
    expect(sql).toContain("Only staff can schedule a showing.");
  });

  it("el trigger corre como quien escribe; solo el helper de lectura es SECURITY DEFINER", () => {
    const guard = sql.slice(sql.indexOf("create or replace function public.guard_showing_nbr()"));
    expect(guard.slice(0, guard.indexOf("as '"))).not.toContain("security definer");
    const helper = sql.slice(sql.indexOf("create or replace function public.nbr_notice_accepted"), sql.indexOf("create or replace function public.guard_showing_nbr()"));
    expect(helper).toContain("security definer");
    expect(sql).toContain("revoke all on function public.guard_showing_nbr() from public, anon, authenticated;");
  });
});

describe("pantallas y Loui", () => {
  it("el admin comprueba el aviso antes de escribir y reconoce el rechazo de la base", () => {
    const page = readFileSync("src/app/[lang]/admin/buyer-leads/page.tsx", "utf8");
    expect(page).toContain('if (next === "showing_confirmed" || next === "completed") {');
    expect(page).toContain("const nbrBlock = nbrBlockReason({");
    expect(page).toContain('(dbNbrReason(error.message) ?? "agreement_missing")');
    expect(page).toContain("data-nbr-status");
    expect(page).toContain("data-loui-showings");
  });

  it("Loui: sin consejos de precio ni negociación al comprador sin agente, con la frase exacta", () => {
    expect(LOUI_SYSTEM_PROMPT).toContain('"Lixtara represents the seller; we recommend you consult your own agent or attorney."');
    expect(LOUI_SYSTEM_PROMPT).toContain('"Lixtara representa al vendedor; te recomendamos consultar a tu propio agente o abogado."');
    expect(LOUI_SYSTEM_PROMPT).toContain("never say a showing is scheduled or confirmed");
    expect(LOUI_SYSTEM_PROMPT).not.toContain("accompanied by Lixtara's licensed broker through showings, offer and closing");
  });

  it("Loui pide el estado del agente para una visita y no devuelve 'scheduled'", () => {
    const route = readFileSync("src/app/api/loui/route.ts", "utf8");
    expect(route).toContain('error: "buyer_agent_status_required"');
    expect(route).toContain("sendNbrLink(createService(), { scheduleRequestId:");
    expect(route).not.toContain("scheduled: true");
  });
});
