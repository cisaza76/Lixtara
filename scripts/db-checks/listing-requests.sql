-- Verificación de 20261007170000_listing_requests_post_draft_guard contra Postgres real.
-- La corre scripts/db-checks/run-listing-requests.sh DESPUÉS de la réplica de
-- guard-properties-mls-status.sql (roles, auth.uid(), RLS de properties) y de las
-- migraciones 20260927120000 y 20261007170000. NUNCA contra producción.
\set ON_ERROR_STOP on
\set QUIET on

\set seller  '''11111111-1111-4111-8111-111111111111'''
\set otro    '''33333333-3333-4333-8333-333333333333'''
\set broker  '''22222222-2222-4222-8222-222222222222'''
\set P1 '''aaaaaaaa-0000-4000-8000-000000000001'''
\set P2 '''aaaaaaaa-0000-4000-8000-000000000002'''
\set P6 '''aaaaaaaa-0000-4000-8000-000000000006'''
\set P7 '''aaaaaaaa-0000-4000-8000-000000000007'''

-- Una solicitud pendiente de cambio sobre el listing activo P6 (la crea el endpoint con
-- service_role).
insert into public.listing_requests (property_id, kind, changes, requested_by)
values (:P6, 'change', '{"list_price": {"old": null, "new": 480000}}', :seller);

create table pg_temp.casos2 (orden int, grupo text, nombre text, rol text, sub text, stmt text,
  esperado text, resultado text);

insert into pg_temp.casos2 (orden, grupo, nombre, rol, sub, stmt, esperado) values
 -- #136: columnas por estado
 (1, 'estado', 'vendedor cambia el precio de su listing ACTIVO', 'authenticated', :seller,
     format($$update public.properties set list_price = 480000 where id = %L$$, :P6), 'ERR'),
 (2, 'estado', 'vendedor cambia la descripción en pending_approval', 'authenticated', :seller,
     format($$update public.properties set description = 'x' where id = %L$$, :P2), 'ERR'),
 (3, 'estado', 'vendedor edita precio y descripción de su BORRADOR', 'authenticated', :seller,
     format($$update public.properties set list_price = 1, description = 'x' where id = %L$$, :P1), 'OK:1'),
 (4, 'estado', 'vendedor elige pricing_tier en su BORRADOR', 'authenticated', :seller,
     format($$update public.properties set pricing_tier = 'pro' where id = %L$$, :P1), 'OK:1'),
 (5, 'estado', 'vendedor cambia show_phone_on_portals en ACTIVO (no clave)', 'authenticated', :seller,
     format($$update public.properties set show_phone_on_portals = true where id = %L$$, :P6), 'OK:1'),
 (6, 'estado', 'vendedor confirma derechos de fotos en ACTIVO', 'authenticated', :seller,
     format($$update public.properties set photos_rights_confirmed = true where id = %L$$, :P6), 'OK:1'),
 (7, 'estado', 'vendedor refresca comparables en ACTIVO', 'authenticated', :seller,
     format($$update public.properties set price_comps = '[]' where id = %L$$, :P6), 'OK:1'),
 (8, 'estado', 'vendedor mezcla no-clave + precio en ACTIVO (todo o nada)', 'authenticated', :seller,
     format($$update public.properties set show_phone_on_portals = true, list_price = 1 where id = %L$$, :P6), 'ERR'),
 (9, 'estado', 'broker aplica el cambio aprobado en ACTIVO', 'authenticated', :broker,
     format($$update public.properties set list_price = 480000 where id = %L$$, :P6), 'OK:1'),
 (10, 'estado', 'service_role aplica el cambio en ACTIVO', 'service_role', null,
     format($$update public.properties set list_price = 480000 where id = %L$$, :P6), 'OK:1'),
 (11, 'estado', 'vendedor retira su listing escribiendo el estado', 'authenticated', :seller,
     format($$update public.properties set mls_status = 'withdrawn' where id = %L$$, :P6), 'ERR'),
 (12, 'estado', 'vendedor no toca listings ajenos (RLS: 0 filas)', 'authenticated', :seller,
     format($$update public.properties set list_price = 1 where id = %L$$, :P7), 'OK:0'),
 -- listing_requests
 (20, 'solicitudes', 'vendedor inserta su propia solicitud directo (debe ir por el endpoint)', 'authenticated', :seller,
     format($$insert into public.listing_requests (property_id, kind, requested_by) values (%L, 'withdrawal', %L)$$, :P6, :seller), 'ERR'),
 (21, 'solicitudes', 'vendedor ve sus solicitudes', 'authenticated', :seller,
     $$select * from public.listing_requests$$, 'OK:1'),
 (22, 'solicitudes', 'otro vendedor no las ve', 'authenticated', :otro,
     $$select * from public.listing_requests$$, 'OK:0'),
 (23, 'solicitudes', 'anónimo no las ve', 'anon', null,
     $$select * from public.listing_requests$$, 'ERR'),
 (24, 'solicitudes', 'vendedor se auto-aprueba la solicitud (RLS: 0 filas)', 'authenticated', :seller,
     $$update public.listing_requests set status = 'approved'$$, 'OK:0'),
 (25, 'solicitudes', 'vendedor borra su solicitud', 'authenticated', :seller,
     $$delete from public.listing_requests$$, 'ERR'),
 (26, 'solicitudes', 'broker aprueba', 'authenticated', :broker,
     $$update public.listing_requests set status = 'approved', reviewed_at = now()$$, 'OK:1'),
 (27, 'solicitudes', 'segunda solicitud de cambio pendiente sobre el mismo listing', 'service_role', null,
     format($$insert into public.listing_requests (property_id, kind, changes, requested_by) values (%L, 'change', '{"description": {"old": null, "new": "y"}}', %L)$$, :P6, :seller), 'ERR'),
 (28, 'solicitudes', 'retiro pendiente junto al cambio pendiente (otro tipo)', 'service_role', null,
     format($$insert into public.listing_requests (property_id, kind, requested_by) values (%L, 'withdrawal', %L)$$, :P6, :seller), 'OK:1'),
 (29, 'solicitudes', 'solicitud de cambio sin campos', 'service_role', null,
     format($$insert into public.listing_requests (property_id, kind, changes, requested_by) values (%L, 'change', '{}', %L)$$, :P2, :seller), 'ERR'),
 (30, 'solicitudes', 'tipo desconocido', 'service_role', null,
     format($$insert into public.listing_requests (property_id, kind, requested_by) values (%L, 'delete', %L)$$, :P2, :seller), 'ERR'),
 -- broker_tasks
 (40, 'tareas', 'tarea review_listing_change', 'service_role', null,
     format($$insert into public.broker_tasks (property_id, task_type, title) values (%L, 'review_listing_change', 't')$$, :P6), 'OK:1'),
 (41, 'tareas', 'tarea withdraw_listing', 'service_role', null,
     format($$insert into public.broker_tasks (property_id, task_type, title) values (%L, 'withdraw_listing', 't')$$, :P6), 'OK:1'),
 (42, 'tareas', 'tarea de tipo desconocido', 'service_role', null,
     format($$insert into public.broker_tasks (property_id, task_type, title) values (%L, 'nope', 't')$$, :P6), 'ERR');

do $$
declare c record; r text;
begin
  for c in select * from pg_temp.casos2 order by orden loop
    begin
      r := pg_temp.intento(c.rol, c.sub, c.stmt);
      raise exception 'deshacer';
    exception when raise_exception then
      null;
    end;
    update pg_temp.casos2 set resultado = r where orden = c.orden;
  end loop;
end $$;

\pset footer off
\echo
\echo '== CASOS 20261007170000'
select orden as "#", grupo, nombre as caso, resultado, esperado,
       case when resultado like esperado || '%' then 'ok' else '*** FALLA ***' end as veredicto
  from pg_temp.casos2 order by orden;

do $$ begin
  if exists (select 1 from pg_temp.casos2 where resultado not like esperado || '%') then
    raise exception 'HAY CASOS QUE NO COINCIDEN CON LO ESPERADO';
  end if;
end $$;

-- Rollback: el guard vuelve a #133 (el vendedor puede editar el precio del activo) y las
-- solicitudes se conservan.
\echo '== ROLLBACK'
\i docs/superpowers/runbooks/rollback-20261007170000_listing_requests_post_draft_guard.sql
do $$
declare r text;
begin
  r := pg_temp.intento('authenticated', '11111111-1111-4111-8111-111111111111',
    $q$update public.properties set list_price = 480000 where id = 'aaaaaaaa-0000-4000-8000-000000000006'$q$);
  if r <> 'OK:1' then raise exception 'rollback: se esperaba OK:1, salió %', r; end if;
  if (select count(*) from public.listing_requests) <> 1 then
    raise exception 'rollback: se perdieron solicitudes';
  end if;
  raise notice 'rollback ok';
end $$;
