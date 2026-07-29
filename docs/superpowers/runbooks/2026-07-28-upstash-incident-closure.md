# Acta de cierre — Incidente Upstash 2026-07-26

**Resolución:** **CERRAR CON RIESGO RESIDUAL ACEPTADO** — Camilo Isaza (owner), 2026-07-28.
**Motivación registrada:** la causa inmediata fue mitigada; la vulnerabilidad
arquitectónica fue corregida mediante fail-open; la mitigación fue validada mediante
pruebas controladas; no existen acciones técnicas pendientes que condicionen la
estabilidad actual; permanecen riesgos operativos conocidos (monitorización y política
del proveedor), aceptados expresamente y registrados como seguimiento.

**Leyenda:** ✔ hecho comprobado · ~ inferencia · → seguimiento

---

## 1. Identificación

- ✔ Indisponibilidad total del Redis de rate-limiting en Production
  (`stirred-moray-131131.upstash.io`, provisionado ~68 días antes vía Vercel
  Marketplace), con fallo en cascada 500 sobre toda ruta rate-limited.
- ✔ Descubierto 2026-07-26 durante el smoke de Gate 2 (activación uploaded-video).
  Detectado por operación de gate, no por monitoreo — no existía alerting.

## 2. Alcance e impacto

- ✔ Confirmado en vivo: `POST /api/loui` → 500 vacío.
- ~ Por análisis de código, mismo mecanismo aplicable a checkout, offers, saves,
  staging, agreement, media-agent y rutas de video-source (no probadas una a una
  durante el incidente).
- ✔ Ventana de exposición indeterminada: última verificación funcional de los limiters
  2026-05-20; sin monitoreo, el host pudo morir en cualquier punto de esos ~67 días.
- ✔ Impacto en el programa: Gate 2 ABORTADO por protocolo; kill-switch de video
  ejecutado y verificado; Gate 1 mantenido; cero datos creados.

## 3. Cronología

| Fecha | Evento |
|---|---|
| ~2026-05-19 | ✔ Recurso Upstash provisionado vía Marketplace |
| 2026-05-20 | ✔ Limiters verificados en vivo (429 real) — última verificación previa |
| 2026-05-20 → 07-26 | ✔ El host dejó de estar disponible en un punto indeterminado de la ventana |
| 2026-07-26 | ✔ Descubrimiento en smoke Gate 2; Loui 500; DNS no resuelve |
| 2026-07-26 | ✔ Abort Gate 2 + kill-switch ejecutado y verificado |
| 2026-07-26 | ✔ Remediación A: nuevo recurso Marketplace `lixtara-prod-ratelimit`; 5 vars muertas removidas; `KV_*` en 3 ambientes; prod redeployado; Loui 500→200; 429 real en intento 10 |
| 2026-07-26 | ✔ Remediación C: PR #104 mergeado a main (`fe600d9`, +322/−4): `enforceLimit` contiene fallos del proveedor (fail-open + log estructurado `rate_limit_provider_failure` con redacción y throttle 30s); 764/764 tests; simulación de caída verificada en el Preview del PR |
| 2026-07-27 | ✔ 429 reales observados durante verificación de P2 |
| 2026-07-28 | ✔ Probes sin 500s (Loui 200, offers 401); 429 reales del limiter de generate observados en vivo (demos UX 5C); REST del nuevo Redis operativo |

## 4. Causa raíz

- ✔ **Hecho comprobado:** el recurso utilizado por producción dejó de estar disponible
  y su host dejó de resolver DNS.
- ✔ **Hecho comprobado:** en el momento de la remediación el recurso aparecía como
  *Uninstalled* en el proveedor.
- ~ **Inferencia:** el cambio a *Uninstalled* es consistente con una baja automática o
  administrativa del recurso, pero el mecanismo exacto no fue confirmado por el
  proveedor.
- ✔ **Amplificador (defecto propio, corregido):** `enforceLimit` solo hacía fail-open
  cuando Upstash NO estaba configurado; configurado-pero-muerto lanzaba
  `TypeError: fetch failed` sin catch → 500. La caída de una dependencia auxiliar
  tumbó rutas de negocio.

## 5. Factores contribuyentes

1. ✔ Sin monitoreo ni alerting (Sentry sin DSN; sin logs estructurados en la época).
2. ✔ Sin verificación periódica posterior a 2026-05-20.
3. ✔ Modo de fallo "configurado pero inalcanzable" no contemplado en el diseño original.
4. ~ Recurso de free tier para infraestructura de producción, sin política de
   retención conocida.

## 6. Contención inmediata

✔ Abort de Gate 2 por protocolo + kill-switch de video (verificado con 404s). La
contención funcionó exactamente como estaba diseñada.

## 7. Remediación técnica permanente

- ✔ **Infraestructura:** recurso nuevo `lixtara-prod-ratelimit` (Marketplace,
  upstash-kv), vars en los 3 ambientes, vars muertas purgadas de Vercel.
- ✔ **Código (PR #104):** contención de fallos del proveedor — throw/respuesta
  malformada → fail-open + log estructurado con redacción y throttle. Doctrina
  establecida y luego reutilizada por #112 y UX 5C: la protección auxiliar nunca causa
  un 5xx.

## 8. Evidencia de verificación

✔ Loui 500→200 post-remediación · 429 real en prod (07-26) y en el Preview del PR ·
simulación de host muerto en Preview con fail-open + log capturado · probes 07-28 sin
500s · 429 reales en operación normal 07-27 y 07-28 · REST del nuevo Redis operativo
al cierre.

### Criterios objetivos que permiten considerar mitigado el incidente

- No existen 500 derivados del rate limiter. ✔
- La caída del proveedor produce fail-open, no fallo de ruta. ✔ (simulada y testeada)
- Los eventos quedan registrados mediante logging estructurado. ✔
- El nuevo recurso responde correctamente. ✔
- Las pruebas de degradación controlada fueron satisfactorias. ✔

## 9. Riesgo residual — ACEPTADO expresamente en esta resolución

- **R1 — Detección pasiva (el riesgo central aceptado):** si el nuevo recurso muere,
  las rutas siguen funcionando (fail-open, por diseño) y el log
  `rate_limit_provider_failure` se emite — pero sin alerting nadie lo observa:
  producción quedaría sin rate-limiting por tiempo indefinido, silenciosamente.
  **Este riesgo se acepta únicamente hasta la implantación del sistema de alertas
  definido para go-live** (deuda ya registrada: activación de Sentry/alerting).
- **R2 → seguimiento (no bloquea, no queda como incertidumbre permanente):**
  verificar plan/tier y política de eviction del recurso nuevo.
  Responsable: **Owner** · Prioridad: **Baja** · Estado: **Seguimiento post-incidente**.
- **R3 — higiene local:** `.env.local` aún contiene credenciales KV del recurso
  muerto (fail-open en local, sin impacto de producción). Seguimiento menor.

## 10. Lecciones aprendidas

1. "Configurado" ≠ "vivo": toda dependencia auxiliar necesita contención del modo
   configurado-pero-muerto.
2. La verificación única no envejece: 67 días sin re-verificar = ventana de exposición
   indeterminada.
3. El protocolo de gates detectó lo que el monitoreo no existía para detectar; el
   kill-switch demostró su valor.
4. La simulación de caída en Preview (env override con host muerto) queda como
   práctica validada.
5. Operativo: `ephemeralCache` de `@upstash/ratelimit` en instancias warm (ver sección
   correspondiente del runbook de producción).

## 11. Acciones de seguimiento (ninguna condiciona este cierre)

| Acción | Responsable | Prioridad |
|---|---|---|
| Verificar plan/tier + política de eviction del recurso nuevo (R2) | Owner | Baja |
| Actualizar credenciales KV muertas de `.env.local` (R3) | Operador | Baja |
| Alerting sobre `rate_limit_provider_failure` (resuelve R1) | ya en deuda de go-live (Sentry) | — |

## 12. Recomendación (previa a la resolución)

La mitigación técnica está implementada, mergeada y verificada en cuatro fechas
distintas con evidencia independiente. Lo restante no es trabajo técnico pendiente
sino riesgo operativo declarable — declarado y aceptado en la resolución de cabecera.

## 13. Declaración de alcance

**El cierre administrativo de este incidente NO autoriza por sí solo Gate 5C.**
Únicamente completa el cuarto prerrequisito y habilita la convocatoria de la revisión
final de prerrequisitos, conforme a la instrucción del owner del 2026-07-28.

## 14. Checklist para la revisión final de prerrequisitos

- [x] Resolución de esta acta registrada, con R1-R3 explícitamente aceptados/en seguimiento
- [x] #111 cerrado con evidencia congelada (PR #113)
- [x] #112 cerrado con evidencia congelada (PR #115)
- [x] Comunicación al usuario cerrada con evidencia congelada (PR #116)
- [x] Acta congelada en `docs/superpowers/runbooks/` y referenciada desde el Gate Review
- [ ] Revisión final convocada: verificación de no-regresión desde los cierres +
      decisión EXPRESA del owner sobre el inicio de Gate 5C
