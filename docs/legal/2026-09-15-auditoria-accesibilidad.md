# Auditoría de accesibilidad WCAG 2.1 AA

**Fecha:** 2026-09-15 · **Build:** `902b2d6` · **Herramienta:** axe-core 4.10.2 (reglas
`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`) sobre el build de producción, más revisión manual
de teclado, foco, movimiento y landmarks.

**Por qué:** § VII.B.1 del acuerdo de MIAMI AOR obliga a **garantizar** que el sitio *"at all
times, shall be accessible to individuals with disabilities"*, y § VII.D.1 obliga a indemnizar
a MIAMI por reclamaciones de ADA. Deja de ser buena práctica y pasa a ser garantía contractual.

---

## Alcance — y lo que NO cubre

| Auditado | No auditado |
|---|---|
| `/en`, `/en/properties`, `/en/property/[id]`, `/en/sign-in`, `/en/terms`, `/en/dmca` | Flujo del vendedor (`/listing/new`, 3.026 líneas, tras login) |
| Locale `en` | Panel admin (15 páginas, tras login) · locale `es` |

> **axe-core detecta aproximadamente entre un tercio y un 40% de los problemas reales de
> accesibilidad.** Lo que no encuentra —orden de lectura, sentido de los textos alternativos,
> gestión del foco en flujos, comprensión con lector de pantalla— requiere prueba manual con
> tecnología asistiva. **Esta auditoría no sustituye esa prueba**, y la garantía del § VII.B.1
> es sobre el sitio entero, no sobre las páginas medidas aquí.

---

## Resultados por página

| Página | Violaciones | Nodos afectados | Reglas que pasan |
|---|---|---|---|
| `/en` | 2 | 95 contraste · 3 sin etiqueta | 32 |
| `/en/properties` | 1 | 48 contraste | 24 |
| `/en/property/[id]` | 1 | 26 contraste | 27 |
| `/en/sign-in` | 1 | 13 contraste | — |

---

## Hallazgos

### 🔴 A1 · Contraste de `text-ink/55` — *serious*, sistémico

`#7A7E86` sobre `#FCFBF7` da **3.93:1**. WCAG 2.1 AA exige **4.5:1** para texto normal.
Afecta a la navegación, el pie, las etiquetas en versalita y los metadatos — a 10px, que es
donde más duele.

**Medición exacta de `ink` sobre `ivory`:**

| Opacidad | Color | Ratio | AA texto (4.5) |
|---|---|---|---|
| `ink/50` | `#868990` | 3.38 | falla |
| **`ink/55`** | **`#7A7E86`** | **3.93** | **falla ← actual** |
| **`ink/60`** | **`#6E727B`** | **4.66** | **PASA ← mínimo viable** |
| `ink/70` | `#565B67` | 6.57 | pasa |

El primer valor que cruza el umbral es `ink/59` (4.52:1); `ink/60` deja margen.

**Remedio:** sustituir `text-ink/55` → `text-ink/60`. **203 usos en 48 archivos.** Mecánico y
visualmente imperceptible a 10px, pero toca superficie pública, del vendedor y del admin.
`text-ink/50` (9 usos) también falla y necesita el mismo tratamiento.

### 🔴 A2 · Controles deslizantes sin etiqueta — *critical*

Tres `<input type="range">` sin nombre accesible. Un lector de pantalla los anuncia como
«control deslizante» sin decir de qué:

- `components/savings-calculator.tsx:175`
- `components/rebate-slider.tsx:52`
- `components/savings-slider.tsx:176`

**Remedio:** `aria-label` describiendo qué ajusta cada uno, más `aria-valuetext` con el valor
formateado (para que anuncie «$500,000» y no «500000»). Corregido en este commit.

### 🔴 A3 · El dorado de marca falla contraste — *serious, decisión de marca*

`gold #B18E5D` sobre `ivory #FCFBF7` da **2.94:1**. Falla el umbral de texto (4.5) **y también
el de 3:1** que WCAG 1.4.11 exige para componentes de interfaz y gráficos con significado.
Está a 1% de luminosidad de pasar siquiera el umbral no-textual.

| Fondo | Ratio | Texto normal | No-texto (3:1) |
|---|---|---|---|
| sobre `ivory` | **2.94** | FALLA | **FALLA** |
| sobre `ivory-strong` | 2.79 | FALLA | FALLA |
| sobre `ink` | 5.87 | pasa | pasa |

**El dorado solo es seguro como texto sobre fondo oscuro.** Sobre ivory hoy aparece en
eyebrows en versalita, la línea legal bajo el wordmark, `LIXTARA.COM`, acentos de precio y
filetes. **233 usos de `text-gold`.**

Manteniendo el matiz 35° y la saturación 35%:

| Objetivo | Valor | Ratio |
|---|---|---|
| No-texto / texto grande (3:1) | `hsl(35 35% 52%)` = `#AF8C5A` | 3.02 |
| **Texto normal AA (4.5:1)** | **`hsl(35 35% 41%)` = `#8D6F44`** | **4.53** |

**Remedio recomendado — no oscurecer el token global.** Bajar `--color-gold` a 41% ensuciaría
el dorado también sobre ink, donde hoy funciona bien. Mejor introducir un **segundo token**:

```css
--color-gold:      hsl(35 35% 53%);  /* decoración + texto sobre ink — sin cambios */
--color-gold-text: hsl(35 35% 41%);  /* texto dorado sobre fondos claros */
```

y clasificar los 233 usos en tres grupos: texto sobre claro (→ `gold-text`), texto sobre ink
(sin cambio), decoración (sin cambio; los filetes puramente decorativos están exentos de
1.4.11, pero el marco del monograma y los bordes con significado no lo están).

**Esto es decisión del dueño de la marca, no mía.** No toqué ningún color.

### 🟡 A4 · Landmark `<main>` duplicado — *moderate*

`/en/properties` sirve dos `<main>` en el mismo documento: uno de `properties/loading.tsx:14` y
otro de `properties/page.tsx:18`. Igual en `property/[id]`. Un documento debe tener un solo
`main`. Corregido en este commit: el esqueleto de carga pasa a `<div>`.

### 🟡 A5 · Movimiento no respeta `prefers-reduced-motion` — *moderate*

Los esqueletos de carga sí lo respetan (`motion-reduce:animate-none`), pero **`animate-spin`
(6 usos) no**. WCAG 2.3.3 (AAA) y las buenas prácticas de 2.2.2 piden poder desactivarlo.
Corregido: `motion-reduce:animate-none` en los spinners.

### 🟢 A6 · Sin base global de foco visible — *low*

`globals.css` no define ningún estilo `:focus-visible`. Hay 16 declaraciones puntuales en
componentes, y `savings-calculator.tsx:56` usa `focus:outline-none` reemplazándolo por un ring
propio (correcto). El resto depende del anillo por defecto del navegador. Corregido: base
global con el dorado de marca.

---

## Lo que está bien y conviene no romper

- **`before-after-slider.tsx` está bien construido**: `role="slider"`, `tabIndex={0}`,
  `aria-label`, `aria-valuenow`, manejo de flechas y Home/End. Es el patrón a imitar.
- `html lang` correcto en ambos locales.
- Un solo `<h1>` por página, con texto significativo.
- Landmarks `header` / `nav` / `main` / `footer` presentes — con eso se satisface WCAG 2.4.1
  (técnica ARIA11), así que **no hace falta un enlace «saltar al contenido»**, aunque sumaría.
- El formulario de sign-in no tiene controles sin nombre accesible (los únicos sin etiqueta son
  `input[type=hidden]`, que es correcto).

---

## Pendiente para poder sostener la garantía

1. **Decidir A1 y A3** (los dos cambios de color). Son 436 usos entre ambos.
2. **Auditar las superficies tras login**: flujo del vendedor y panel admin. La garantía cubre
   el sitio entero.
3. **Auditar el locale `es`**.
4. **Prueba manual con lector de pantalla** — VoiceOver en Safari cubre el grueso del público
   de Miami-Dade. axe no sustituye esto.
5. **Guard automatizado en CI** para que «at all times» sea verificable y no una aspiración.
6. **Revisión de un especialista** antes de apoyarse en la garantía frente a MIAMI.
