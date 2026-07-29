# Gate 5C — Piloto controlado con usuarios reales (documento operativo)

**Estado:** **APROBADO** — resolución del owner 2026-07-28: «APROBADO PARA GOBERNAR
GATE 5C, SUJETO A VERIFICACIÓN DE LIMPIEZA DOCUMENTAL»; limpieza verificada
mecánicamente (7/7: sin restos de rev. 1, sin encabezados duplicados, H8.1–H8.7
únicos, exclusiones coherentes, checklist coherente con H5, evidencia referida al
punto 10) y estado elevado a APROBADO el 2026-07-28. Historia: rev. 1 «aprobado en
estructura, con cambios bloqueantes» → rev. 2 con los 6 cambios incorporados →
aprobación final. Este documento GOBIERNA la ejecución del piloto.
**La aprobación de este documento NO es el Go de apertura** (punto 11).
**Autorización vigente:** inicio formal del TRABAJO de Gate 5C (2026-07-28). La
apertura al primer participante requiere el **Go** expreso del punto 11.
**Antecedentes:** Gate Review aprobado 2026-07-28 · prerrequisitos 4/4 cerrados
(#111 PR #113 · #112 PR #115 · comunicación PR #116 · acta Upstash `bc887cf`).

---

## 1. Objetivo

Validar con usuarios reales, bajo la gobernanza de Gates 5A/5B, que el pipeline de
video (photos y uploaded_video) y su experiencia de producto — incluida la
**notificación real al seller** — están listos para una apertura más amplia,
produciendo la evidencia para esa decisión.

## 2. Hipótesis a validar

- **H1 (producto/autonomía):** un seller real completa el flujo SIN asistencia. La
  autonomía se mide ANTES de cualquier ayuda (ver protocolo de intervención, punto 6).
- **H2 (entradas reales):** sources reales no controlados se procesan correctamente o
  se rechazan fail-closed con comunicación accionable (kinds UX 5C), nunca opacamente.
- **H3 (gobernanza):** allowlist, cuotas, aislamiento y RLS aguantan usuarios reales.
- **H4 (operación):** el evidence pack (#112) basta para diagnosticar desde la DB.
- **H5 (notificación):** el email terminal llega AL SELLER REAL, se entiende, y
  produce la acción correcta (volver a revisar/descargar; reemplazar el source;
  contactar soporte). Con override activo esta hipótesis NO es evaluable — por eso el
  override se retira antes del Go (punto 3).

## 3. Alcance

- **Cohorte inicial: DOS participantes, secuenciales** — uno con `photo_slideshow` y
  uno con `uploaded_video`. Revisión y cierre de evidencia del participante 1 ANTES de
  abrir al participante 2. Ampliar la cohorte = nueva decisión del owner.
- 1 listing por participante; producción real (allowlist-gated; el resto fail-closed).
- Grants por listing con **`max_generations = 3` exactamente** para esta cohorte
  (aumentar exige razón operativa concreta y sign-off); vigencia definida; alta con
  sign-off; revocación al cierre.
- **Emails — regla de override (cambio bloqueante 1):** `EMAIL_DEV_OVERRIDE_TO` de
  Production puede permanecer SOLO durante preparación y ensayos internos.
  **Se retira antes del Go de apertura al primer seller real.** El participante recibe
  sus propios emails (H5); el owner/operador verifica mediante logs estructurados, DB
  y seguimiento directo. No existe entrega dual en el código actual y NO se autoriza
  implementarla dentro de Gate 5C.
- **Remitente:** `onboarding@resend.dev` aceptado SOLO para esta cohorte cerrada y
  SOLO si la prueba de entrega previa al Go (punto 5) es satisfactoria; si no entrega
  de forma fiable, el piloto no abre hasta verificar `lixtara.com` u otro remitente
  válido.

## 4. Exclusiones

Sin apertura amplia · sin cambios de visibilidad pública · sin re-render de históricos ·
sin features/variables nuevas (incluida la entrega dual de email) · sin emails por
locale (deuda post-piloto) · sin migraciones/esquema · sin cambios al modelo de grants ·
sin activación de Sentry (R1 del acta cubierto con revisión manual diaria).

## 5. Criterios de entrada (checklist previo al Go de CADA participante)

**Del documento y el entorno:**
- [ ] Este documento aprobado por el owner.
- [ ] `EMAIL_DEV_OVERRIDE_TO` retirado de Production (verificado) — cambio bloqueante 1.
- [ ] Verificación previa: 0 grants activos ajenos al piloto; 0 jobs no terminales;
      estado previo de assets y jobs del listing capturado (snapshot en el expediente).
- [ ] Runbook a mano: kill-switch, worker, consultas de evidencia y de referencia.

**Del participante (cambio bloqueante — registro completo):**
- [ ] Seller identificado y **consentimiento para participar** registrado.
- [ ] Listing exacto identificado (`active`, con fotos interiores).
- [ ] Estrategia que probará: `photos` o `uploaded_video` (según su posición en la
      cohorte).
- [ ] **Email verificado mediante prueba previa (cambio bloqueante 2):**
      1) correo de prueba enviado al participante con el remitente del piloto;
      2) recepción confirmada por el participante;
      3) carpeta de spam comprobada;
      4) enlaces del correo apuntan al entorno correcto;
      5) resultado registrado en este checklist.
- [ ] Teléfono o canal alternativo de contacto registrado.
- [ ] Operador asignado y ventana horaria de observación acordada.
- [ ] Confirmación de que no existe otro job en curso para el listing.
- [ ] Grant creado con sign-off (listing-scoped, `max_generations = 3`, motivo con
      referencia a este documento).

## 6. Protocolo por participante

1. **Alta:** checklist del punto 5 completo; ids registrados en el expediente.
2. **Ejecución autónoma primero (cambio bloqueante 4):** el participante opera SOLO.
   El operador observa sin intervenir. Si el seller duda o se detiene:
   a) primero se OBSERVA el intento autónomo y se registra dónde se detuvo;
   b) solo después se presta asistencia;
   c) toda ayuda se clasifica: **aclaración verbal · navegación · corrección de
      datos · intervención técnica**;
   d) un flujo completado con ayuda NO se contabiliza como completado autónomamente
      (H1 se evalúa sobre el tramo previo a la primera asistencia).
3. **Observación por job:** estado del job; DTO seller (kind/CTAs correctos); email
   terminal **recibido por el seller** (variante, contenido, timing — confirmado con
   el participante) e idempotencia; evidence pack en fallos.
4. **Verificación técnica por éxito:** integridad (checksum == outputHash == descarga,
   como 5A/5B) + probe del contrato de color (#111) en muestreo.
5. **Cierre del participante:** resultado y fricción revisados con el participante;
   expediente congelado (punto 10) con conclusión por hipótesis; decisión del owner
   antes de abrir al siguiente.
6. **Incidente:** halt criteria (punto 8); congelar evidencia SIEMPRE.
7. **Cierre de cohorte:** revocación de todos los grants; verificación 0 activos.

## 7. Observabilidad durante el piloto

- **Diaria:** consultas del runbook (fallos por categoría, PREPARATION/QA con
  evidencia, jobs no terminales), `video_worker_run` en logs, y — sin override — la
  verificación de emails se hace por logs de envío + confirmación directa del
  participante.
- **Por fallo:** reconstrucción DB-only (#112); un fallo inexplicable desde la DB es
  en sí un hallazgo (H4 falla).
- **Referencias de soporte:** consulta del runbook.

## 8. Criterios de detención (halt)

**Halt inmediato + kill-switch** (flag OFF + verificación 404) ante:
- H8.1 Incidente de seguridad/aislamiento (acceso cruzado, fuga pública, bypass de
  allowlist o RLS).
- H8.2 Sobre-consumo de cuota o grant fuera de su alcance.
- H8.3 Divergencia de integridad (checksum/outputHash/descarga).
- **H8.4 (cambio bloqueante 6 — privacidad): email terminal enviado a un destinatario
  distinto del seller autorizado o del destinatario operativo aprobado.**

**Pausa (sin nuevos jobs/participantes) hasta explicación** ante:
- H8.5 Fallo cuya causa no pueda reconstruirse desde la DB.
- H8.6 Anomalía de costo/duración (referencia 5A/5B: 42–145 s; alarma p95 > 10 min).
- H8.7 Email incorrecto en contenido (fuga técnica, doble envío, variante errónea).

Reanudación tras cualquier halt/pausa: decisión expresa del owner.

## 9. Criterios de salida (definición de éxito — Gate Review aprobado)

1. **Ningún incidente** de seguridad, aislamiento o gobernanza (incluido H8.4).
2. **Todas las desviaciones** explicadas.
3. **Evidencia suficiente** para decidir la ampliación (expedientes congelados; grants
   revocados).

**Métricas (evidencia, NO definición):** tasa de éxito autónomo (per H1, sin contar
flujos asistidos); tasa y causas de rechazo de sources; tiempos generate→completed;
fricción por participante; **resultado de H5 con destinatarios reales** (recepción,
comprensión, acción — contenido/timing/idempotencia en producción).

## 10. Unidad de evidencia: expediente individual por participante (cambio bloqueante 5)

Cada participante tiene UN expediente único que incluye: estado inicial (snapshot de
assets/jobs del listing) · timestamps de cada paso · estrategia · source utilizado
(cuando aplique) · job(s) y transiciones · resultado del QA · emails terminales
(variante, destinatario, timing, confirmación del seller) · acciones del seller ·
intervenciones del operador (clasificadas) · incidentes · resultado final ·
**conclusión por hipótesis H1–H5**.

## 11. Decisión Go / No-Go

- **Go de apertura (participante 1):** decisión expresa del owner con el checklist del
  punto 5 completo — incluida la verificación de que el override fue retirado y la
  prueba de entrega real. La aprobación de este documento NO la constituye.
- **Go intermedio (participante 2):** decisión del owner tras el cierre del expediente
  del participante 1.
- **Go/No-Go de salida:** al cierre de la cohorte, decisión del owner sobre la
  apertura amplia. Prerrequisitos ya registrados para esa apertura: dominio verificado
  en Resend (remitente propio) · emails por locale del seller · alerting que resuelve
  el R1 del acta Upstash.
- **No-Go / halt:** el gate puede cerrarse como fallido o suspenderse en cualquier
  punto por decisión del owner; la evidencia congelada forma el expediente igualmente.
