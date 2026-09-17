# DMCA — registro del agente y manejo de notificaciones

**Por qué existe:** el safe harbor del 17 U.S.C. § 512 solo protege si el agente está
**registrado ante la Copyright Office Y publicado en el sitio**. El acuerdo de datos de MIAMI
AOR § VII.B.2 exige lo mismo como **condición previa** para activar el feed del MLS.

---

## ✅ Registro COMPLETADO — 2026-09-10

| Campo | Valor |
|---|---|
| **Registration Number** | `DMCA-1080195` |
| Entidad (service provider) | `LIXTARA LLC` |
| Fecha de registro | **2026-09-10** |
| **Vence** | **2029-09-10** |
| Pay.gov Tracking ID | `285SDUVV` · $6.00 |

**Agente designado — datos PÚBLICOS** (los que aparecen en `/dmca`):

```
Copyright Agent
LIXTARA LLC
181 Vera Court
Coral Gables, FL 33143
United States
Email: dmca@lixtara.com
Telephone: 786-210-3562
```

**Contacto del service provider — ADMINISTRATIVO, nunca se publica:**
`camilo@lixtara.com` · `305-522-3454`. Es el contacto de la cuenta ante la Copyright Office, no
un canal de avisos. `publicAgentBlock()` solo lee los campos públicos, y un test verifica que el
administrativo no aparezca en ninguna página.

### ✅ Estado ACTIVE confirmado — 2026-09-10

Correo de confirmación de la U.S. Copyright Office (`donotreply@loc.gov`):
**Status: Active · Effective: September 10, 2026 to Present**. Los 12 campos del registro
fueron cotejados uno a uno contra el código: coinciden exactamente.

El correo confirma además la separación de contactos:

> *"The below information, **except for the service provider's phone number and email address**,
> can now be viewed in the DMCA Designated Agent Directory."*

La propia Copyright Office retiene del directorio público el teléfono y correo del service
provider. `publicAgentBlock()` aplica la misma regla en el sitio.

### 🔴 Vencimiento: 2029-09-10 — no se renueva solo

Al vencer, el registro pasa a **Terminated** y el safe harbor del § 512 **desaparece en
silencio**: nada en el producto falla, simplemente deja de haber protección.

Por eso hay un **guard en la suite de tests** (`dmca-agent.test.ts`). Se pone rojo el
**2029-07-12**, 60 días antes, y bloquea los cinco gates hasta que se recertifique. Verificado:
a 61 días pasa, a 60 falla, vencido falla.

**Cuando el test falle:**
1. Recertifica en https://dmca.copyright.gov (~$6, ~15 min)
2. Actualiza `registeredOn` y `expiresOn` en `src/lib/legal/dmca-agent.ts`
3. Actualiza las fechas fijadas en el primer test de `dmca-agent.test.ts`

> Un recordatorio de calendario **además** del guard no sobra, pero el guard es la red que no
> depende de que nadie se acuerde. Un cron a tres años vista no es fiable; el test sí, porque
> corre en cada push.

### ⚠️ La dirección publicada es residencial

`181 Vera Court, Coral Gables` queda publicada en `/dmca` **y en el directorio público de la
Copyright Office** — la ley exige que la dirección del agente sea pública, así que ya lo es
por el registro mismo. Si prefieres no exponer un domicilio particular, la alternativa es
re-registrar con la dirección de un *registered agent* o un buzón comercial. Es una decisión
tuya, no un defecto.

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

- **Registro de reincidentes** — declarado en `/dmca` §6, **no implementado**. El § 512(i) exige
  implementarlo razonablemente, no solo declararlo. Hace falta llevar cuenta de notificaciones
  válidas por cuenta y definir el umbral de terminación.
- **Buzón `dmca@lixtara.com`** — confirmar que existe, que recibe y que alguien lo vigila. Está
  publicado como canal oficial: si rebota, el procedimiento no funciona.
- **Revisión de abogado** — la política sigue el texto del § 512, pero no ha pasado por counsel
  de Florida.
- ~~Verificar estado "Active"~~ ✅ confirmado 2026-09-10.
