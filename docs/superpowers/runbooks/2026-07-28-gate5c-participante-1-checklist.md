# Gate 5C — Checklist de entrada: PARTICIPANTE 1

**Gobernado por:** `docs/superpowers/plans/2026-07-28-gate-5c-pilot.md` (APROBADO
2026-07-28), punto 5. **Estrategia asignada al participante 1:** `photo_slideshow`
(primero de la cohorte de dos; el participante 2 será `uploaded_video`).
**Estado:** EN PREPARACIÓN — el Go de apertura exige TODAS las casillas marcadas y la
autorización expresa del owner al final de este documento.

Convenciones: `[OWNER]` = dato/acción que solo el owner puede aportar ·
`[SELLER]` = requiere al participante · `[OPERADOR]` = ejecuta el operador y registra
aquí la evidencia.

---

## A. Documento y entorno

- [x] Documento operativo de Gate 5C aprobado por el owner (2026-07-28, `main`).
- [ ] `[OPERADOR]` `EMAIL_DEV_OVERRIDE_TO` **retirado de Production** y verificado.
      *Método:* eliminar la env var (target production) → redeploy → constatar en el
      listado que ya no existe para production. Registrar timestamp y deployment.
      *Nota:* hacerlo INMEDIATAMENTE antes de la ventana del piloto, no días antes —
      mientras esté retirado, cualquier email transaccional de la plataforma va a su
      destinatario real.
- [ ] `[OPERADOR]` Verificación previa registrada (mismo día del Go):
      - 0 grants activos ajenos al piloto: `select count(*) from
        creative_studio_video_access where revoked_at is null;` → esperado 0.
      - 0 jobs no terminales: `select count(*) from creative_jobs where state not in
        ('completed','failed','cancelled');` → esperado 0.
      - Snapshot del estado previo del listing (assets y jobs) guardado en el
        expediente del participante.
- [ ] `[OPERADOR]` Runbook a mano: kill-switch (flag OFF + 404), invocación del worker,
      consultas de evidencia (#112) y de referencia (UX 5C), gotcha ephemeralCache.

## B. Participante

- [ ] `[OWNER]` Seller identificado: nombre + user_id: ______________________________
- [ ] `[OWNER/SELLER]` **Consentimiento para participar registrado** (fecha, medio y
      texto/acta breve): ______________________________
- [ ] `[OWNER]` Listing exacto (id): ______________________________
      · `[OPERADOR]` verificado `mls_status = active` y fotos interiores presentes.
- [x] Estrategia: `photo_slideshow` (posición 1 de la cohorte).
- [ ] `[OPERADOR]` **Prueba de entrega de email (5 pasos, cambio bloqueante 2):**
      1. [ ] Correo de prueba enviado al email real del seller con remitente
             `onboarding@resend.dev` (id de envío: ____________)
      2. [ ] Recepción confirmada por el seller (fecha/hora: ____________)
      3. [ ] Carpeta de spam comprobada (resultado: ____________)
      4. [ ] Enlaces apuntan al entorno correcto (`NEXT_PUBLIC_SITE_URL` de
             production; verificado: ____________)
      5. [ ] Resultado global registrado: APTO / NO APTO — si NO APTO, el piloto no
             abre (regla del remitente, punto 3 del documento).
- [ ] `[OWNER]` Teléfono o canal alternativo de contacto del seller: ________________
- [ ] `[OWNER]` Operador asignado (por defecto: el operador del programa) y ventana
      horaria acordada con el seller: ______________________________
- [ ] `[OPERADOR]` Confirmación de que no existe otro job en curso para el listing
      (consulta + resultado en el expediente).
- [ ] `[OWNER→OPERADOR]` Grant creado con sign-off del owner:
      `insert into creative_studio_video_access (user_id, listing_id, enabled,
      max_generations, approved_by, reason) values ('<user>', '<listing>', true, 3,
      '<owner-user-id>', 'Gate 5C — participante 1 (photo_slideshow), gobernado por
      docs/superpowers/plans/2026-07-28-gate-5c-pilot.md');`
      (id del grant: ____________)

## C. Expediente inicializado

- [ ] `[OPERADOR]` Expediente individual creado (punto 10 del documento): ids,
      snapshot inicial, campos H1–H5 preparados, registro de intervenciones vacío.

## D. Go de apertura

> Con A+B+C completos, el owner emite (o deniega) el **Go expreso de apertura del
> participante 1**. Ni la aprobación del documento ni este checklist lo constituyen.

**Decisión del owner:** ______________ · Fecha/hora: ______________
