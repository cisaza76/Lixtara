# Runbook de lanzamiento — Stripe a modo live

**Fecha:** 2026-09-27 · **Estado:** vigente, **no ejecutado** (Stripe sigue en modo test:
clave `sk_test_`, sesiones `cs_test_…`).

Este runbook reúne las condiciones que deben cumplirse **antes** de cambiar las claves de
Stripe a modo live en Production. No sustituye la activación de la cuenta de Stripe ni el
cambio de claves en Vercel; los precede.

---

## 1 · Ningún listing activo sostenido solo por pagos de prueba

**Regla:** antes de pasar Stripe a live, todo listing en `active` (o `pending_approval`) cuyos
únicos pagos confirmados sean de prueba debe **volver a `draft`** o **pagar de verdad** en
modo live. Un pago de prueba no es un pago: con Stripe en live, ese listing estaría publicado
sin haber cobrado.

Un pago es de prueba si su sesión de Checkout es de modo test (`cs_test_…`); los de modo live
empiezan por `cs_live_…`.

```sql
-- Listings activos o en cola SIN ningún pago live confirmado.
select p.id, p.address_street, p.mls_status, p.pricing_tier, p.is_test,
       count(pay.*) filter (where pay.status = 'succeeded') as pagos_ok,
       count(pay.*) filter (where pay.status = 'succeeded'
                              and pay.stripe_checkout_session_id like 'cs_live_%') as pagos_live
  from public.properties p
  left join public.payments pay on pay.property_id = p.id
 where p.mls_status in ('active', 'pending_approval')
 group by p.id
having count(pay.*) filter (where pay.status = 'succeeded'
                              and pay.stripe_checkout_session_id like 'cs_live_%') = 0
 order by p.mls_status, p.address_street;
```

**Debe devolver 0 filas** antes del cambio. Cada fila se resuelve de una de dos formas:

- **Volver a `draft`** — con el rol `service_role` (o desde el panel de admin: "Request
  changes"), para que el vendedor pague en live. El cambio queda en
  `property_status_history` automáticamente (migración `20260927120000`).
- **Pago real** en modo live, confirmado por el webhook.

Los registros de prueba (`is_test = true`) no se publican nunca, pero también deben salir de
`active`: el 2026-09-27 los 9 conocidos (6 `[DEMO]` + 3 direcciones reales usadas para
pruebas) pasaron a `withdrawn` — ver `activity_log` con
`metadata->>'batch' = 'test-data-withdrawal-2026-09-27'`.

`payments` y las sesiones de Stripe de prueba **no se tocan**: son historial.

## 2 · Datos de prueba en producción

Las pruebas se hacen en **preview**, no en producción. Si hace falta probar algo en
producción, el registro se crea con `is_test = true` (solo admin o `service_role` pueden
ponerlo), y ninguna lectura pública lo muestra sin importar su estado.

```sql
-- Nada de prueba debe quedar publicado.
select id, address_street, mls_status from public.properties
 where is_test and mls_status = 'active';
-- 0 filas.
```
