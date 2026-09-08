# DMCA — registro del agente y manejo de notificaciones

**Por qué existe:** el safe harbor del 17 U.S.C. § 512 solo protege si el agente está
**registrado ante la Copyright Office Y publicado en el sitio**. El acuerdo de datos de MIAMI
AOR § VII.B.2 exige lo mismo como **condición previa** para activar el feed del MLS.

---

## Parte 1 — Registrar el agente (acción del owner, ~15 min, ~$6)

Esto **no lo puede hacer nadie más**: requiere la cuenta de la entidad, el pago y declaraciones
legales en nombre de Lixtara, LLC.

1. Entra a **https://dmca.copyright.gov** y crea una cuenta de *service provider*.
2. Registra la **entidad legal**: `Lixtara, LLC`. No un nombre comercial ni una persona.
3. Designa el agente. Puede ser un rol, no obligatoriamente una persona nombrada:
   - **Nombre:** `Copyright Agent, Lixtara, LLC`
   - **Dirección postal:** la de la LLC en Miami *(debe ser una dirección real que reciba correo)*
   - **Correo:** `dmca@lixtara.com` — **créalo antes**, tiene que recibir de verdad
   - **Teléfono:** un número atendible
4. Paga la tasa (~$6) y guarda el comprobante.
5. **Anota la fecha de registro.** Caduca a los **3 años** y hay que renovarlo.

### Parte 2 — Pasar los datos al código

Abre `src/lib/legal/dmca-agent.ts` y reemplaza los tres marcadores con los valores
**exactamente como quedaron registrados** (si no coinciden con el registro, el safe harbor
queda defectuoso):

```ts
addressLines: ["[STREET ADDRESS]", "Miami, Florida [ZIP]", "United States"],
phone: "[PHONE]",
registeredOn: "[YYYY-MM-DD]",
```

Luego, en `src/lib/legal/dmca-agent.test.ts`, quita el `.skip` del test
`SKIP-UNTIL-REGISTERED`. A partir de ahí queda bloqueada cualquier regresión que vacíe el
registro.

> ⚠️ **No despliegues a producción con los marcadores puestos.** Una página DMCA en vivo con
> `[STREET ADDRESS]` anuncia un procedimiento que no funciona: es peor que no tenerla.

---

## Parte 3 — Qué hacer al recibir una notificación

**El reloj corre desde la recepción.** Dos plazos distintos:

| Plazo | Obligación |
|---|---|
| **24 horas** | Si el material es contenido de fichas del MLS, reenviar **copia completa** a MIAMI |
| *Expedito* (sin plazo fijo) | Retirar o deshabilitar el material identificado |

### Reenvío a MIAMI — a las DOS direcciones

Lixtara es simultáneamente **Participant** (§ VII.C.2 → `dmca@miamire.com`) y **Technology
Provider** (§ VII.B.2 → `legal@miamire.com`). El acuerdo nombra direcciones distintas para cada
rol, así que **envía a ambas**. Las constantes viven en
`src/lib/legal/dmca-agent.ts#MLS_TAKEDOWN_NOTICE_RECIPIENTS`.

### Secuencia

1. **Registra la hora de recepción.** Es el inicio de las 24 h.
2. **¿Cumple la notificación los 6 elementos** del § 512(c)(3)(A) (ver `/dmca` §2)? Si le falta
   algo sustancial, no dispara la obligación de retirar — pero responde pidiendo lo que falta.
3. **Si el material viene del feed del MLS:** reenvía copia completa a las dos direcciones de
   MIAMI dentro de las 24 h. Guarda el correo enviado como evidencia.
4. **Retira o deshabilita** el material identificado.
5. **Avisa a quien lo subió** (el vendedor) y entrégale copia de la notificación.
6. **Archiva todo**: notificación, hora, acción tomada, reenvío a MIAMI, aviso al vendedor.

### Si llega una contranotificación

1. Verifica los 5 elementos del § 512(g)(3) (ver `/dmca` §4).
2. Reenvía copia al reclamante original.
3. **Espera entre 10 y 14 días hábiles.** Repone el material al cumplirse el plazo, **salvo** que
   el reclamante avise que inició acción judicial.
4. Ni antes ni después: reponer temprano rompe el safe harbor; no reponer expone a reclamo del
   usuario.

### Reincidentes

`/dmca` §6 compromete una política de terminación de cuentas de infractores reincidentes
(§ 512(i)). **Hay que implementarla de verdad**, no solo declararla: lleva registro de
notificaciones válidas por cuenta y define el umbral. Hoy no existe ese registro — es deuda
abierta.

---

## Qué quedó construido

| Archivo | Qué es |
|---|---|
| `src/lib/legal/dmca-agent.ts` | Datos del agente + constantes de reenvío a MIAMI |
| `src/lib/legal/dmca-agent.test.ts` | Guard: falla si el registro queda incompleto |
| `src/lib/legal/dmca.ts` | Política EN/ES con los elementos del § 512 |
| `src/app/[lang]/dmca/page.tsx` | Ruta `/en/dmca` y `/es/dmca` |
| `src/app/[lang]/layout.tsx` | Enlace en la columna Legal del footer |
| `src/lib/i18n.ts` | `footer.links.dmca` en ambos idiomas |

## Deuda abierta

- **Registro de reincidentes** — declarado en la política, no implementado.
- **Buzón `dmca@lixtara.com`** — hay que crearlo y que alguien lo vigile.
- **Revisión de abogado** — esta política sigue el texto del § 512, pero no ha pasado por
  counsel de Florida.
