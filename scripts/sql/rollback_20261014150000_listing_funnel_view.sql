-- Reversión de 20261014150000_listing_funnel_view. Correr a mano, con OK del owner.
--
-- Qué hace:
--   1. Borra la vista listing_funnel_v y el índice nuevo. No se pierde ningún dato.
--   2. CONSERVA la columna is_test y le pone default false: así el código anterior (que no la
--      conoce) puede volver a insertar, y las pruebas ya marcadas siguen separadas de los datos
--      reales. Borrar la columna las mezclaría para siempre (la tabla no se edita).
--   El bloque comentado al final la borra solo si no hay ninguna fila is_test = true.
-- Orden: revertir el código primero o después da igual; recordFunnelEvent nunca lanza, a lo
-- sumo se pierden eventos mientras la base y el código no coinciden.

drop view if exists public.listing_funnel_v;
drop index if exists public.funnel_events_property_idx;

-- Para que el código anterior (que no conoce la columna) pueda volver a insertar sin error:
alter table public.funnel_events alter column is_test set default false;

-- do $$
-- begin
--   if exists (select 1 from public.funnel_events where is_test) then
--     raise exception 'hay eventos de prueba: borrar is_test los mezclaría con los reales';
--   end if;
--   alter table public.funnel_events drop column is_test;
-- end $$;
