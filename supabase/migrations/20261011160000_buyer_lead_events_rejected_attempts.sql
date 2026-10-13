-- Historial de buyer leads: registrar también los intentos RECHAZADOS.
--
-- Una escritura que la base rechaza (confirmar una visita sin acuerdo, un admin sin
-- licencia registrando un acuerdo) se revierte entera, así que el trigger del historial no
-- la ve. La cola de admin la registra aparte, con la clave secreta y el usuario que lo
-- intentó, como evento `rejected_attempt`. Sirve de rastro de auditoría.
--
-- Solo amplía la lista de tipos de evento: sin nuevas políticas, el historial sigue sin
-- escritura desde la API (solo el trigger y el servidor con la clave secreta).
--
-- Sin `$$` ni corchetes: se pega en el SQL Editor. Idempotente. Aplicar SOLO con sign-off
-- del owner. El código funciona antes y después: si falta, el registro del intento falla en
-- silencio (con log) y la acción rechazada se comporta igual.

alter table public.buyer_lead_events drop constraint if exists buyer_lead_events_event_type_check;
alter table public.buyer_lead_events add constraint buyer_lead_events_event_type_check
  check (event_type in ('created', 'status_changed', 'assigned', 'handler_changed',
                        'agreement_recorded', 'rejected_attempt'));
