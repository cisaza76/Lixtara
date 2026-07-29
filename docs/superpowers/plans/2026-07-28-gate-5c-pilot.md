# Gate 5C — Piloto controlado con usuarios reales (documento operativo)

**Estado:** BORRADOR — pendiente de aprobación del owner. Una vez aprobado, este
documento GOBIERNA la ejecución del piloto y es la referencia para avanzar o detener.
**Autorización vigente (2026-07-28):** inicio formal del TRABAJO de Gate 5C. La
apertura del piloto al primer participante requiere la decisión **Go** expresa del
punto 11 — nunca es automática.
**Antecedentes:** Gate Review ejecutivo aprobado 2026-07-28 (criterios de éxito y
diseño de cohorte) · prerrequisitos 4/4 cerrados con evidencia congelada
(#111 PR #113 · #112 PR #115 · comunicación PR #116 · acta Upstash `bc887cf`).

---

## 1. Objetivo

Validar con usuarios reales, bajo la misma gobernanza estricta de Gates 5A/5B, que el
pipeline de video (photos y uploaded_video) y su experiencia de producto están listos
para una apertura más amplia — produciendo la evidencia necesaria para esa decisión.

## 2. Hipótesis a validar

- **H1 (producto):** un seller real completa el flujo (subir video / usar fotos →
  generar → revisar resultado) sin intervención manual del equipo en el camino feliz.
- **H2 (entradas reales):** los sources reales no controlados (HDR, rotación, códecs,
  tamaños/duraciones límite) son o bien procesados correctamente o bien rechazados
  fail-closed **con comunicación accionable** (kinds de UX 5C), nunca con fallo opaco.
- **H3 (gobernanza):** allowlist, cuotas, aislamiento y RLS se comportan con usuarios
  reales igual que en 5A/5B.
- **H4 (operación):** el evidence pack de #112 basta para diagnosticar cualquier fallo
  desde la DB, sin reconstrucción manual.

## 3. Alcance

- Cohorte **pequeña y observable**: el tamaño lo determina la capacidad de observación
  del equipo, no un N objetivo (Gate Review). Ejecución serial o semi-serial: un
  participante nuevo solo entra cuando el anterior está estable.
- 1 listing por participante; ambas estrategias admitidas (la que corresponda al
  participante).
- Producción real (allowlist-gated; el resto del mundo sigue fail-closed).
- Grants por listing con `max_generations ≥ 3` y vigencia definida; alta con sign-off
  del owner, baja (revocación) al cierre de cada participante o de la cohorte.
- **Emails:** activos, con `EMAIL_DEV_OVERRIDE_TO` de Production **mantenido** durante
  la primera cohorte (decisión owner 2026-07-28): todas las notificaciones llegan al
  buzón de supervisión; el seguimiento del participante es manual. Remitente
  `onboarding@resend.dev` aceptado **solo para el piloto cerrado**.

## 4. Exclusiones

Sin apertura amplia · sin cambios de visibilidad pública del video · sin re-render de
assets históricos · sin features nuevas ni variables nuevas durante el piloto · sin
retiro del override de email en esta cohorte · sin emails por locale (deuda post-piloto
registrada) · sin migraciones ni cambios de esquema · sin cambios al modelo de grants ·
sin activación de Sentry (R1 del acta Upstash se cubre con revisión manual diaria).

## 5. Criterios de entrada (checklist previo al Go del primer participante)

- [ ] Este documento aprobado por el owner.
- [ ] Participante identificado, informado y dispuesto (sabe que es piloto, sabe a
      quién reportar fricción; NO recibirá los emails directamente en esta cohorte).
- [ ] Listing del participante en estado `active` con fotos interiores.
- [ ] Grant creado con sign-off (listing-scoped, `max_generations ≥ 3`, motivo con
      referencia a este documento).
- [ ] Operador disponible durante la ventana de generación (capacidad de observación).
- [ ] Runbook a mano: kill-switch, cron/worker, consultas de evidencia y de referencia.
- [ ] Verificación previa: 0 grants activos ajenos al piloto; 0 jobs no terminales.

## 6. Protocolo por participante

1. **Alta:** grant con sign-off; registro de ids (participante, listing, grant).
2. **Ejecución:** el participante opera SOLO (H1); el operador observa sin intervenir.
   En producción el cron procesa los jobs (el código de main ES el código validado —
   la carrera Preview/prod del runbook no aplica al piloto).
3. **Observación por job:** estado del job, DTO seller (kind/CTAs correctos), email en
   el buzón de supervisión (contenido, timing, idempotencia), evidence pack en fallos.
4. **Verificación técnica por éxito:** integridad (checksum == outputHash == descarga
   como en 5A/5B) + probe del contrato de color (#111) en muestreo.
5. **Cierre del participante:** resultado revisado con el participante; fricción
   anotada; evidencia congelada; decisión de continuar con el siguiente.
6. **Incidente:** aplicar halt criteria (punto 8); congelar evidencia SIEMPRE.
7. **Cierre de cohorte:** revocación de todos los grants; verificación 0 activos.

## 7. Observabilidad durante el piloto

- **Diaria (operador):** consultas del runbook — fallos por categoría, últimos
  PREPARATION/QA con evidencia, jobs no terminales, `video_worker_run` en logs de
  función; buzón de supervisión de emails.
- **Por fallo:** reconstrucción DB-only (#112); si la DB no explica un fallo, eso es en
  sí un hallazgo de gate (H4 falla).
- **Referencia de soporte:** los códigos de referencia que reporte un participante se
  resuelven con la consulta del runbook.

## 8. Criterios de detención (halt)

**Halt inmediato + kill-switch** (flag OFF + verificación 404) ante:
- H8.1 Cualquier incidente de seguridad/aislamiento (acceso cruzado, fuga en página
  pública, bypass de allowlist o RLS).
- H8.2 Cualquier sobre-consumo de cuota o grant operando fuera de su alcance.
- H8.3 Cualquier divergencia de integridad (checksum/outputHash/descarga).

**Pausa (sin nuevos jobs ni participantes) hasta explicación** ante:
- H8.4 Un fallo cuya causa no pueda reconstruirse desde la DB.
- H8.5 Anomalía de costo o de duración fuera de todo rango conocido (referencia
  5A/5B: 42–145 s; alarma orientativa: p95 > 10 min).
- H8.6 Email incorrecto (contenido con fuga técnica, doble envío, o variante errónea).

La reanudación tras cualquier halt/pausa exige decisión expresa del owner.

## 9. Criterios de salida (definición de éxito del gate — Gate Review aprobado)

El gate es exitoso si y solo si:
1. **Ningún incidente** comprometió seguridad, aislamiento o gobernanza.
2. **Todas las desviaciones** observadas quedaron explicadas.
3. **Evidencia suficiente** para decidir si el producto está listo para ampliarse
   (expediente congelado con la disciplina de 5A/5B; todos los grants revocados).

**Métricas operativas (evidencia para la decisión, NO definición de éxito):** tasa de
éxito funcional sin intervención; tasa y causas de rechazo de sources reales (una tasa
muy alta = señal de producto contra la apertura amplia aunque el gate sea limpio);
tiempos generate→completed; fricción reportada por participante.

**Criterio específico de notificaciones (owner, 2026-07-28) — condición para retirar el
override antes de ampliar:** primera cohorte completada sin incidencias relevantes en el
flujo de notificaciones + validación de contenido + timing + idempotencia en producción.

## 10. Evidencia requerida

- **Por participante:** ids (participante/listing/grant/jobs/assets), hashes, DTOs
  relevantes, emails observados (asunto/variante/timing), fricción anotada.
- **Por incidente:** evidence pack + cronología + resolución, congelados.
- **De cohorte:** resumen con métricas del punto 9, hallazgos, y recomendación.

## 11. Decisión Go / No-Go

- **Go de apertura (primer participante):** decisión expresa del owner con el
  checklist del punto 5 completo. La aprobación de este documento NO la constituye.
- **Go/No-Go de salida:** al cierre de la cohorte, el owner decide sobre la apertura
  más amplia con la evidencia del punto 10. Prerrequisitos ya registrados para esa
  apertura: retiro del override de email (criterio del punto 9), dominio verificado en
  Resend (remitente propio), emails por locale del seller, y el alerting que resuelve
  el R1 del acta Upstash.
- **No-Go / halt:** el gate puede cerrarse como fallido o suspenderse en cualquier
  punto por decisión del owner; la evidencia congelada hasta ese momento forma el
  expediente igualmente.
