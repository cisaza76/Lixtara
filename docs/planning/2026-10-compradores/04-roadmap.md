# Roadmap MVP / V2 / V3

> Ver los bloqueos completos en `00-plan-maestro.md` § 13.

**Convención:**
- **[Construir]:** se puede desarrollar ya.
- **[Activar]:** su publicación tiene bloqueos.
- **Bloqueos:** MIAMI (P1–P6) · ABOGADO (#1–16) · OWNER (decisión o acción manual).

## MVP · embudo del comprador con atención humana (sin IA, sin firma online)

| # | Funcionalidad | Construir | Activar | Criterio de aceptación |
|---|---|---|---|---|
| M1 | Exhibición MLS (Fase 3) | Hecho | OWNER: `MLS_DISPLAY_ENABLED` tras 24 h de sync en verde | Fichas en lixtara.com con atribución; 0 en `lixtara.vercel.app` |
| M2 | Tarjetas clicables + **detalle MLS** (dirección, cuartos, baños, fotos por hot-link, atribución y avisos) | Sí | MIAMI P5 | Tests de atribución; nada de next/image; ninguna IA importa el módulo |
| M3 | **"Solicitar visita con Lixtara"**: `buyer_leads` + `lead_assignees` + `lead_events`, 9 estados, regla "visita confirmada requiere acuerdo", email a la broker, cola admin y confirmación | Sí (migración con sign-off) | MIAMI P4 · copy C.2 aprobado · ABOGADO #10 (consentimientos) | Lead creado en < 3 s; email entregado; imposible confirmar la visita sin registro contractual (test de base de datos) |
| M4 | Filtros de ciudad y tipo (columnas con trigger) | Sí (migración con sign-off) | Con M1 | Relleno en tandas < timeout; tests |
| M5 | Analítica: banner de consentimiento, GTM+GA4, PostHog (autocapture y grabación apagados en páginas MLS), catálogo de eventos y eventos de servidor por estado | Sí | Texto de consentimiento y política de privacidad aprobados | Eventos sin datos personales ni MLS (revisión con payloads reales); embudos comprador y vendedor visibles |
| M6 | Nueva sección de compradores en la landing; rebate desactivado; `CLAUDE.md` actualizado | Sí | OWNER aprueba el copy C.1 | Sin %, rebate ni "AI"; test de nombre de broker en verde |

**Métricas MVP:**
- solicitudes por semana;
- **tiempo hasta el primer contacto** (meta: dentro del SLA publicado);
- % contactos efectivos;
- % acuerdos firmados;
- % visitas realizadas;
- ofertas y cierres;
- horas de la broker por lead.

**Salida del MVP:** al menos 8 semanas de datos, o al menos 30 solicitudes, lo que llegue primero. La decisión de pasar a V2 se toma con esos datos.

## V2 · acuerdo digital y asesor de búsqueda

| # | Funcionalidad | Bloqueo | Criterio de aceptación |
|---|---|---|---|
| V2.1 | Showing Agreement de Lixtara en DocuSign + resumen previo + opción "hablar sobre compensación" con el mismo peso visual | ABOGADO #1–8, #11 | Plantilla aprobada; resumen validado; sin patrones oscuros (revisión de UX) |
| V2.2 | Desglose de compensación previo a la oferta (escenario A) y registro de excepciones | ABOGADO #6, #15 | Documento firmado, guardado y vinculado al lead |
| V2.3 | **Asesor de búsqueda** (parser ciego) en `/properties`, detrás de un feature flag | **MIAMI P1 por escrito**, P2 | Set offline ≥ 100 frases con exactitud ≥ 90 % por campo; red-team de Fair Housing al 100 %; test `ai-boundary` en verde; bloqueo de contenido pegado |
| V2.4 | Búsquedas guardadas (con cuenta y consentimiento) y alertas | MIAMI P3 | Alertas solo con enlace si P3 lo exige |
| V2.5 | Asignación a asociados (UI mínima en el admin) | ABOGADO #12 · OWNER (relaciones definidas) | Historial completo en `lead_events` |
| V2.6 | Cláusulas B2 en listings nuevos | ABOGADO #13–14 | Contrato aprobado; sin cambio automático a listings existentes |

**Métricas V2:**
- tasa de firma frente a "hablar primero";
- tasa efectiva de compensación;
- uso del asesor;
- tiempo hasta el primer resultado;
- fichas abiertas por sesión;
- lead por sesión.
- **A/B solo con volumen suficiente.**

## V3 · diferenciación (justificada por los datos de V2)
- Mapa con pins (MIAMI P5).
- "Más como esta" determinístico.
- Chips de coincidencia determinísticos.
- Anexo de propiedades al Showing Agreement.
- Acuerdo de comprador exclusivo (ABOGADO #11).
- Búsqueda por trayecto a un lugar elegido por el usuario (datos de mapas, nunca MLS en IA).
- Calculadora de costos para inversionistas **con números que ingresa el usuario**.

## Lo que NO deberíamos construir todavía
- Embeddings o búsqueda semántica sobre fichas MLS.
- Cualquier IA que lea, describa, compare o puntúe fichas MLS (incluidos el Match Score con IA, la búsqueda por imágenes y el asesor de inversión con datos MLS).
- Memoria de conversación entre sesiones (basta con las búsquedas guardadas).
- Cuentas o paneles para agentes.
- Fichas patrocinadas.
- Datos de colegios, crimen o "estilo de vida" por zona (riesgo de Fair Housing).
- Automatización de SMS.
- Experimentos A/B sin volumen.
- Rebates o créditos al comprador (decisión comercial separada, sin tomar).
- Mostrar porcentajes del comprador en la landing.

---
