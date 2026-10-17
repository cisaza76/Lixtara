-- Reversión de 20261016200000_seller_leads_is_test. Correr a mano, con OK del owner.
-- Revertir PRIMERO el código: el código nuevo escribe y filtra por is_test.
-- Borra la columna: los leads de prueba vuelven a mezclarse con los reales en el admin.
alter table public.seller_leads drop column if exists is_test;
