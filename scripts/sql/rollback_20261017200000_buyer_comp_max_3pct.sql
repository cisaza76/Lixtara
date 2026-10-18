-- Reversión de 20261017200000_buyer_comp_max_3pct. Correr a mano, con OK del owner.
-- Revertir PRIMERO el código (el paso 6 con tope de 3%); sin eso, la base acepta hasta 6% pero
-- el sitio sigue rechazando más de 3%. No borra datos.

alter table public.properties drop constraint if exists properties_buyer_agent_comp_values_check;
alter table public.properties add constraint properties_buyer_agent_comp_values_check
  check (
    buyer_agent_comp_type is null
    or (buyer_agent_comp_type = 'none'
        and coalesce(buyer_agent_commission, 0) = 0 and buyer_agent_comp_amount is null)
    or (buyer_agent_comp_type = 'percent'
        and coalesce(buyer_agent_commission, 0) > 0 and coalesce(buyer_agent_commission, 0) <= 6
        and buyer_agent_comp_amount is null)
    or (buyer_agent_comp_type = 'amount'
        and coalesce(buyer_agent_comp_amount, 0) > 0 and coalesce(buyer_agent_commission, 0) = 0)
  );
