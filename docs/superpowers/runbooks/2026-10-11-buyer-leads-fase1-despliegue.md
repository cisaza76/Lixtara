# Runbook · Buyer leads, fase 1: migración, despliegue y rollback

- **Migración:** `supabase/migrations/20261011150000_buyer_leads_showing_requests.sql`
- **Rollback:** `docs/superpowers/runbooks/rollback-20261011150000_buyer_leads_showing_requests.sql`
- **Estado:** preparado, **no ejecutado**. Cada paso requiere autorización expresa del owner.
- **Activación pública:** NO forma parte de este runbook. `BUYER_SHOWING_REQUESTS_ENABLED` sigue sin definirse hasta que se resuelvan MIAMI (P4) y el abogado.

---

## 0 · Qué se verificó antes de proponerlo (2026-10-11)

### Datos en producción (consulta del owner)
- `buyer_leads`: **0** filas.
- `agent_partners`: **0** filas.
- No hay datos históricos que transformar. La migración igual preserva cualquier fila previa: la marca `legacy` y conserva su estado.

### Ensayo en PGlite con roles simulados de Supabase
Roles simulados: `anon`, `authenticated`, `service_role`, `user_roles`, `has_role` e `is_admin_or_broker`. Se verificaron 27 comprobaciones:
- **Aplicación:** la migración se aplica dos veces sin error sobre el esquema actual.
- **Anónimo y Realtor externo con cuenta (sin rol):** 0 leads, 0 agentes y 0 eventos. No pueden insertar, modificar ni escribir el historial.
- **Admin:**
  - ve los leads;
  - **no** puede registrar acuerdos (42501);
  - no escribe el historial a mano;
  - puede confirmar la visita **solo** con un acuerdo ya registrado.
- **Broker:** registra acuerdos. La excepción `not_required` solo procede con motivo de catálogo y en un listing propio. Se rechazan:
  - una ficha de otro broker;
  - un texto libre;
  - la falta de motivo;
  - "acuerdo firmado" con una excepción.
- **Restricciones:**
  - no puede existir una segunda broker de registro;
  - no se aceptan estados históricos en leads nuevos.
- **Historial:** registra la creación (servidor), la asignación, el acuerdo y el cambio de estado (staff).
- **Rollback:** deja el esquema **idéntico** al original, borra el registro de la migración y permite volver a aplicarla.

### Dependencias de la migración (deben existir; las comprueba la verificación previa)
- `public.properties`
- `public.agent_partners` (de 20260521230143)
- `public.buyer_leads` (de 20260521230654)
- `auth.users`
- `public.has_role(app_role)`
- `public.is_admin_or_broker()`
- `public.user_roles`

---

## 1 · Verificación previa (solo lectura)

Pegar en el SQL Editor. Cada fila debe decir `ok = true`. Las filas marcadas *info* solo informan.

```sql
select 'buyer_leads filas' as chequeo, (select count(*) from public.buyer_leads)::text as valor, '0' as esperado,
       (select count(*) from public.buyer_leads) = 0 as ok
union all select 'agent_partners filas', (select count(*) from public.agent_partners)::text, '0',
       (select count(*) from public.agent_partners) = 0
union all select 'buyer_lead_events aún no existe', coalesce(to_regclass('public.buyer_lead_events')::text, 'no existe'), 'no existe',
       to_regclass('public.buyer_lead_events') is null
union all select 'columnas nuevas ya presentes', (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'buyer_leads'
           and column_name in ('source','legacy_status','listing_key','property_id','preferred_times','message',
             'other_agent_status','needs_to_sell','lang','consent_contact_at','consent_marketing_at','consent_version',
             'handled_by_agent_id','agreement_type','agreement_recorded_at','agreement_reference',
             'agreement_exception_code','agreement_note','cancel_reason'))::text, '0',
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'buyer_leads'
           and column_name in ('source','legacy_status','listing_key','property_id','handled_by_agent_id','agreement_type')) = 0
union all select 'función has_role(app_role)', coalesce(to_regprocedure('public.has_role(public.app_role)')::text, 'FALTA'), 'existe',
       to_regprocedure('public.has_role(public.app_role)') is not null
union all select 'función is_admin_or_broker()', coalesce(to_regprocedure('public.is_admin_or_broker()')::text, 'FALTA'), 'existe',
       to_regprocedure('public.is_admin_or_broker()') is not null
union all select 'tabla properties', coalesce(to_regclass('public.properties')::text, 'FALTA'), 'existe',
       to_regclass('public.properties') is not null
union all select 'migración aún no registrada', (select count(*) from supabase_migrations.schema_migrations
         where version = '20261011150000')::text, '0',
       (select count(*) from supabase_migrations.schema_migrations where version = '20261011150000') = 0
union all select 'info · políticas actuales', (select string_agg(tablename || ': ' || policyname, ' | ' order by tablename, policyname)
         from pg_policies where schemaname = 'public' and tablename in ('buyer_leads','agent_partners')), 'buyer leads admin, buyer leads own, agents admin manage, agents read active', true
union all select 'info · usuarios con rol broker', (select count(*) from public.user_roles where role = 'broker')::text,
       '1 o más antes de registrar acuerdos', true;
```

---

## 2 · Respaldo

- **Datos:** hoy `buyer_leads` y `agent_partners` tienen 0 filas, así que no hay datos que respaldar. Si la verificación previa muestra filas, **detenerse**. Exportar cada tabla a CSV (Table Editor → Export) y avisar antes de seguir.
- **Esquema:** el estado anterior está versionado en el repo (`20260521230143`, `20260521230654`) y el rollback lo restaura exactamente (probado).
- **Plataforma:** en Supabase → Database → Backups, anotar la fecha del último backup automático antes de aplicar. Es la red de seguridad final, no el plan de recuperación.

---

## 3 · Aplicar la migración (requiere autorización expresa)

1. **Fuera del minuto :23**, cuando corre el sync del MLS (no comparte tablas, pero evita ruido).
2. Pegar **todo** el contenido del archivo de migración en una pestaña nueva del SQL Editor y presionar **Run**. Esperado: *Success. No rows returned*.
3. Registrar la versión:

```sql
insert into supabase_migrations.schema_migrations (version, name)
values ('20261011150000', 'buyer_leads_showing_requests')
on conflict (version) do nothing;
```

**Si el paso 2 falla:** la migración es idempotente, así que se puede corregir y volver a correr. Si el error no es claro, **no** reintentar a ciegas: copiar el mensaje y revisarlo.

---

## 4 · Verificación posterior (solo lectura)

Todas las filas deben decir `ok = true`.

```sql
select 'columnas nuevas en buyer_leads' as chequeo,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'buyer_leads'
          and column_name in ('source','legacy_status','listing_key','property_id','preferred_times','message',
            'other_agent_status','needs_to_sell','lang','consent_contact_at','consent_marketing_at','consent_version',
            'handled_by_agent_id','agreement_type','agreement_recorded_at','agreement_reference',
            'agreement_exception_code','agreement_note','cancel_reason'))::text as valor, '19' as esperado,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'buyer_leads'
          and column_name in ('source','legacy_status','listing_key','property_id','preferred_times','message',
            'other_agent_status','needs_to_sell','lang','consent_contact_at','consent_marketing_at','consent_version',
            'handled_by_agent_id','agreement_type','agreement_recorded_at','agreement_reference',
            'agreement_exception_code','agreement_note','cancel_reason')) = 19 as ok
union all select 'restricciones de reglas',
       (select count(*) from pg_constraint where conrelid = 'public.buyer_leads'::regclass and conname in
          ('buyer_leads_status_check','buyer_leads_source_check','buyer_leads_exception_code_check',
           'buyer_leads_showing_consent_check','buyer_leads_exception_rule',
           'buyer_leads_agreement_before_showing','buyer_leads_signed_is_written') and convalidated)::text, '7',
       (select count(*) from pg_constraint where conrelid = 'public.buyer_leads'::regclass and conname in
          ('buyer_leads_status_check','buyer_leads_source_check','buyer_leads_exception_code_check',
           'buyer_leads_showing_consent_check','buyer_leads_exception_rule',
           'buyer_leads_agreement_before_showing','buyer_leads_signed_is_written') and convalidated) = 7
union all select 'triggers', (select string_agg(tgname, ', ' order by tgname) from pg_trigger
          where tgrelid = 'public.buyer_leads'::regclass and not tgisinternal),
       'buyer_lead_events_log, guard_buyer_leads_agreement',
       (select count(*) from pg_trigger where tgrelid = 'public.buyer_leads'::regclass and not tgisinternal
          and tgname in ('buyer_lead_events_log','guard_buyer_leads_agreement')) = 2
union all select 'RLS activa (3 tablas)', (select string_agg(relname || '=' || relrowsecurity, ', ' order by relname)
          from pg_class where oid in ('public.buyer_leads'::regclass, 'public.agent_partners'::regclass, 'public.buyer_lead_events'::regclass)),
       'todas true',
       (select bool_and(relrowsecurity) from pg_class where oid in
          ('public.buyer_leads'::regclass, 'public.agent_partners'::regclass, 'public.buyer_lead_events'::regclass))
union all select 'políticas', (select string_agg(tablename || ': ' || policyname || ' (' || cmd || ')', ' | ' order by tablename, policyname)
          from pg_policies where schemaname = 'public' and tablename in ('buyer_leads','agent_partners','buyer_lead_events')),
       'solo staff en las 3 tablas',
       (select count(*) from pg_policies where schemaname = 'public' and tablename in ('buyer_leads','agent_partners','buyer_lead_events')) = 3
       and (select count(*) from pg_policies where schemaname = 'public'
            and policyname in ('buyer leads own', 'agents read active')) = 0
union all select 'funciones no ejecutables por anon/authenticated',
       (has_function_privilege('anon', 'public.guard_buyer_leads_agreement()', 'execute')
        or has_function_privilege('authenticated', 'public.guard_buyer_leads_agreement()', 'execute')
        or has_function_privilege('anon', 'public.buyer_lead_events_log()', 'execute')
        or has_function_privilege('authenticated', 'public.buyer_lead_events_log()', 'execute'))::text, 'false',
       not (has_function_privilege('anon', 'public.guard_buyer_leads_agreement()', 'execute')
        or has_function_privilege('authenticated', 'public.guard_buyer_leads_agreement()', 'execute')
        or has_function_privilege('anon', 'public.buyer_lead_events_log()', 'execute')
        or has_function_privilege('authenticated', 'public.buyer_lead_events_log()', 'execute'))
union all select 'una sola broker de registro (índice único)', coalesce(to_regclass('public.agent_partners_one_broker_of_record')::text, 'FALTA'),
       'existe', to_regclass('public.agent_partners_one_broker_of_record') is not null
union all select 'migración registrada', (select count(*) from supabase_migrations.schema_migrations
          where version = '20261011150000')::text, '1',
       (select count(*) from supabase_migrations.schema_migrations where version = '20261011150000') = 1
union all select 'buyer_leads sigue vacía', (select count(*) from public.buyer_leads)::text, '0',
       (select count(*) from public.buyer_leads) = 0;
```

---

## 5 · Compatibilidad entre código y esquema

| Combinación | Efecto | Riesgo |
|---|---|---|
| **Código actual + esquema nuevo** (después de migrar, antes del deploy) | La `/admin/buyer-leads` vieja lee columnas que siguen existiendo. Sus botones escriben estados viejos (`qualified`, `assigned`…), que la base **rechaza** en leads nuevos. Con 0 filas no hay nada que editar. `/admin/analytics` solo cuenta `lead_quality` y sigue igual. | Bajo |
| **Código nuevo + esquema viejo** (si se desplegara antes de migrar) | La cola nueva no puede leer las columnas nuevas y aparece vacía. Una solicitud de staff falla con 500. El público no ve nada, porque el interruptor está cerrado y la ruta responde 404. | Bajo, solo staff |
| **Orden recomendado** | Migrar → verificar → (en otra autorización) push → PR → CI → merge → deploy | — |

---

## 6 · Despliegue y pruebas posteriores (cada paso con autorización expresa)

1. **Push** de `feat/buyer-leads-phase1` y apertura del PR. CI corre las 5 verificaciones y Vercel crea un preview, que no es producción.
2. **Merge** cuando CI esté en verde, lo que despliega a producción. Confirmar que el deploy quedó en *Ready*.
3. **Pruebas de humo en producción.** El interruptor sigue cerrado durante todas:
   - Sin sesión, `POST /api/showing-requests` → **404**.
   - Sin sesión, `/en/admin/buyer-leads` → redirige al login.
   - Con sesión de admin: la cola carga vacía y sin error.
   - **Solicitud de prueba (staff):** con sesión de admin, abrir la consola del navegador en lixtara.com y enviar una solicitud con un `listing_key` real tomado de `select listing_key from public.mls_listings limit 1;` y **su propio email**.
     - Esperado: `{ ok: true }`.
     - Llegan los dos emails.
     - El lead aparece en la cola asignado a la broker de registro.
     - El historial muestra "created" y "assigned".
   - **Reglas desde la cola:**
     - mover a "Showing confirmed" sin acuerdo → mensaje de error y nada cambia;
     - registrar un acuerdo con la cuenta de admin → "Only the licensed broker…".
   - **Limpieza** (con autorización): borrar el lead de prueba por su id.
4. **Broker de registro sin duplicados:** después de la primera solicitud, `select count(*) from public.agent_partners where relationship = 'broker_of_record';` debe dar **1**. La fila se crea desde `src/config/brokerage.ts`, y el índice único más la relectura del código impiden un duplicado aunque lleguen dos solicitudes a la vez.

**Requisito antes de operar con compradores reales (no antes del deploy):** Anamaria necesita una cuenta con rol `broker`. Sin ella **nadie** puede registrar acuerdos y, por tanto, ninguna visita puede pasar a "confirmada". Hoy no hay ninguna cuenta con ese rol.

---

## 7 · Rollback

**Código:** Vercel → Deployments → el deploy anterior → **Instant Rollback**. Es inmediato y no toca la base.

**Esquema** (solo si hace falta, después de revertir el código):
1. Exportar a CSV `buyer_leads`, `buyer_lead_events` y `agent_partners` si tienen filas.
2. Pegar el archivo de rollback completo en el SQL Editor y correrlo **una sola vez**.
3. Verificar:
   - `select count(*) from supabase_migrations.schema_migrations where version = '20261011150000';` → 0;
   - `to_regclass('public.buyer_lead_events')` → null;
   - las políticas "buyer leads own" y "agents read active" restauradas.

**Probado en PGlite:** el rollback deja el esquema idéntico al original y la migración se puede volver a aplicar después.

---

## 8 · Seguridad: resumen de la auditoría

### Acceso a `buyer_leads`, `buyer_lead_events` y `agent_partners`
- **Solo staff** (`is_admin_or_broker`: roles `admin` o `broker` en `user_roles`).
- Estar en `agent_partners` **no** es una cuenta ni da acceso: es una fila del roster.
- Un Realtor externo con cuenta de usuario y sin rol no ve nada (probado).
- **Regla operativa:** **nunca** dar el rol `broker` a un Realtor externo o asociado. Ese rol ve **todos** los leads. El acceso por asignación de la etapa 2 necesitará su propio diseño (política por `handled_by` vinculada a un usuario), con aprobación.

### Políticas eliminadas
- **"buyer leads own":** dejaría al comprador leer las notas internas y el registro contractual. Ningún código la usaba.
- **"agents read active":** exponía el contacto de los agentes a cualquier usuario con sesión. Ningún código la usaba.

### Escrituras públicas
- **Ninguna política de INSERT** para `anon` ni `authenticated`.
- La solicitud entra solo por `POST /api/showing-requests`, que tiene:
  - interruptor fail-closed (404);
  - límite por IP;
  - validación de lista cerrada;
  - campo trampa;
  - clave secreta del lado servidor.
- **La respuesta** solo devuelve `{ ok, exclusive }`, sin datos personales.
- **Los logs** no llevan datos del comprador.

### Acuerdos
- Solo el rol `broker` los registra (trigger con error 42501).
- Las excepciones solo salen del catálogo y solo aplican a listings propios.
- Todo queda en el historial con el actor.

### IA
- `ai-boundary.test.ts` impide que una superficie de IA, o una ruta que la alcance, nombre las tablas de leads.

### Pendientes conocidos
- Si Upstash falla, el límite deja pasar las solicitudes (fail-open).
- Sin Turnstile propio.
- Alguien podría usar el formulario para enviar el email de confirmación a una dirección ajena. Lo mitigan el límite de 5 por hora y el interruptor cerrado.
- Los textos de consentimiento son borradores para el abogado.
