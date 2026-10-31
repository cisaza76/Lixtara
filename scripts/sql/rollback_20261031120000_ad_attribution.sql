-- Reversión de 20261031120000_ad_attribution.sql. Borra los identificadores guardados
-- (no hay otra copia: la API de Conversiones deja de tener IP y navegador para la firma y
-- el pago). Después: supabase migration repair --status reverted 20261031120000
drop table if exists public.ad_attribution;
