# Arnés E2E — ciclo de vida del Source Video

Valida el contrato del PR #121 contra un despliegue real, de forma repetible y **sin depender
de la sesión personal de nadie**.

    upload → source vigente → remove → source inexistente → reupload → source vigente

## Garantías estructurales

- **Nunca opera sobre una cuenta real.** `qa-session.ts` rechaza arrancar si `E2E_QA_EMAIL`
  no pertenece a `@lixtara-test.invalid`.
- **Nunca publica un listing.** El listing QA se crea y permanece en `draft`.
- **Generar es imposible, no solo "no invocado".** El grant se crea con `max_generations = 0`
  (el schema lo permite: `CHECK (max_generations >= 0)`), así que `/generate` queda denegado
  por cuota mientras la visibilidad —que ignora la cuota— sigue activa.
- **Nunca toca** jobs, auditoría histórica, listings reales, flags ni variables de entorno.

## Uso

    pnpm e2e:source                  # capa A (HTTP), ambos fixtures, contra Production
    E2E_APP_ORIGIN=https://… pnpm e2e:source

    pnpm e2e:ui-setup    /tmp/s.json # capa B: deja listing+grant+source y emite la sesión
    pnpm e2e:ui-teardown /tmp/s.json # revoca grant y retira artefactos

Requiere en `.env.local`:

    E2E_QA_EMAIL=qa-e2e@lixtara-test.invalid
    E2E_QA_PASSWORD="…"       ← ENTRECOMILLADO SIEMPRE

> **Trampa conocida.** El parser de `--env-file` de Node trata `#` en un valor sin comillas
> como comentario y trunca el resto. El shell no. Entrecomilla todos los secretos.

Ejecutar desde la raíz del repo (`--env-file=.env.local` es relativo al cwd). Desde un
worktree, pasar la ruta absoluta:

    pnpm exec tsx --env-file=/ruta/al/repo/.env.local scripts/e2e/source-lifecycle.ts

## Fixtures

Sintéticos, sin datos personales, deterministas. Regenerables con:

    ffmpeg -hide_banner -loglevel error -nostdin -y \
      -f lavfi -i "testsrc2=size=640x360:rate=24:duration=3" \
      -c:v libx264 -pix_fmt yuv420p -profile:v high -crf 32 -g 24 \
      -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
      -an -fflags +bitexact -flags:v +bitexact -movflags +faststart \
      -f <mp4|mov> qa-source.<mp4|mov>

| Fixture | Bytes | SHA-256 |
|---|---|---|
| `qa-source.mp4` | 122750 | `3d4232e97cb58ae938b00ce7338ad2f1673991a1cf3f633197dad4756de84fb8` |
| `qa-source.mov` | 122701 | `c2b8d20d7beef0c7996d0d251424a88b44d6834a2f4e6c4916263ef42042e539` |

## Oráculos: dos trampas que producen falsos verdes

1. **"El objeto se borró"** NO se comprueba descargando la URL firmada: el CDN de Supabase
   sigue sirviendo una copia cacheada tras el borrado. La autoridad es el catálogo
   (`storage.objects`), vía `objectExists()`.
2. Un locator ausente hacía que la comprobación de Storage pasara por accidente. Toda
   aserción debe fallar de forma ruidosa cuando su entrada no existe.

## Rate limits

`initiate`, `complete` y `DELETE` están limitados a 20/h por usuario. Un run completo consume
~4 · ~4 · ~6. Tres runs seguidos agotan la ventana. Por contrato (`outcome.ts`): un 429 dentro
del run es **FAIL**; uno detectado en la precondición es **ABORT**. **`SKIP` no existe.**

## Limpieza

`finally` revoca el grant y retira objetos y assets sintéticos. El listing QA queda en `draft`
y **la auditoría se conserva**: es evidencia legítima del contrato, no basura.
