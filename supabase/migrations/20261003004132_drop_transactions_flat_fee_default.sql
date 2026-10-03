-- Quita el DEFAULT 499 de transactions.nexxos_flat_fee (herencia del prototipo Lovable).
--
-- Ninguna tarifa de Lixtara es $499 — la fuente de verdad es src/lib/pricing-tiers.ts
-- (199 / 495 / 995). El código no inserta en `transactions`, pero una fila creada a mano
-- sin flat fee quedaba con 499 y así aparecía en /admin/transactions/[id]. Sin default,
-- la columna queda NULL hasta que se registre la tarifa real del plan (el admin ya
-- muestra NULL como vacío vía money()).
--
-- Decisión del owner (2026-10-02): sin default — tampoco 495, porque la tarifa depende
-- del plan. `listing_agreements.flat_fee DEFAULT 499` NO se toca (tabla legacy, sin uso).
--
-- No modifica filas existentes. Idempotente.

ALTER TABLE public.transactions
  ALTER COLUMN nexxos_flat_fee DROP DEFAULT;
