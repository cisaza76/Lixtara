-- Endurece el "append-only" de funnel_events y cierra privilegios sobrantes.
--
-- Supabase otorga por defecto TRUNCATE / REFERENCES / TRIGGER a anon y authenticated en
-- cada tabla nueva de `public`. TRUNCATE no pasa por RLS. PostgREST no expone TRUNCATE,
-- así que hoy no es explotable por la API — pero contradice el diseño append-only de
-- funnel_events y no tiene ningún uso en estas tres tablas. Se revocan.
--
-- Hallado al verificar en producción la migración 20261003004631 (2026-10-02).
-- Idempotente. NO APLICADA — requiere sign-off del owner.

revoke truncate, references, trigger on public.funnel_events from anon, authenticated;
revoke truncate, references, trigger on public.seller_leads from anon, authenticated;
revoke truncate, references, trigger on public.email_verification_challenges from anon, authenticated;
