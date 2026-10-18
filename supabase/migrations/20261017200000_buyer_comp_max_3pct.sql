-- Tope de la compensación al agente del comprador: el porcentaje va de más de 0 hasta 3%
-- (antes 6). Regla de Lixtara, no ley ni regla del MLS (decisión del owner 2026-10-17).
-- El monto fijo también tiene tope (3% del precio de lista), pero depende del precio, que el
-- vendedor puede cambiar en el borrador después del paso 6: un CHECK lo convertiría en un
-- error al guardar el precio. Ese tope lo validan el paso 6 y /api/agreement/create
-- (offerWithinLimit), no la base.
--
-- Si alguna fila ya tiene más de 3%, la migración se detiene SIN cambiar nada y dice
-- cuántas: hay que resolverlas antes (el vendedor vuelve a elegir en el paso 6).
--   select id, mls_status, buyer_agent_commission from public.properties
--    where buyer_agent_comp_type = 'percent' and buyer_agent_commission > 3;
--
-- Idempotente. Reversión: scripts/sql/rollback_20261017200000_buyer_comp_max_3pct.sql.
-- Verificación: pnpm db-check:buyer-comp.

do $$
declare
  v_over int;
begin
  select count(*) into v_over
    from public.properties
   where buyer_agent_comp_type = 'percent' and coalesce(buyer_agent_commission, 0) > 3;
  if v_over > 0 then
    raise exception 'buyer_comp_max_3pct: % fila(s) con más de 3%%; resolverlas antes de aplicar', v_over;
  end if;
end;
$$;

-- Igual que 20261017150000 salvo el tope del porcentaje (6 → 3).
alter table public.properties drop constraint if exists properties_buyer_agent_comp_values_check;
alter table public.properties add constraint properties_buyer_agent_comp_values_check
  check (
    buyer_agent_comp_type is null
    or (buyer_agent_comp_type = 'none'
        and coalesce(buyer_agent_commission, 0) = 0 and buyer_agent_comp_amount is null)
    or (buyer_agent_comp_type = 'percent'
        and coalesce(buyer_agent_commission, 0) > 0 and coalesce(buyer_agent_commission, 0) <= 3
        and buyer_agent_comp_amount is null)
    or (buyer_agent_comp_type = 'amount'
        and coalesce(buyer_agent_comp_amount, 0) > 0 and coalesce(buyer_agent_commission, 0) = 0)
  );
