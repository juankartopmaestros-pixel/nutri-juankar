# API Nutri Juankar

Servidor propio que recibe una foto de un alimento o etiqueta, la lee con Claude, aplica las reglas CDIET de la nutricionista y devuelve un semáforo y una nota de 0 a 10.

- **Proyecto Supabase:** `nutri-juankar` (región Frankfurt, eu-central-1, plan gratuito)
- **Dirección:** `https://anncshionedpjcmjqxiq.supabase.co/functions/v1/analizar`
- **App conectada:** `../nutri-juankar-app.html`

## Puesta en marcha

1. Añade la clave de Anthropic como secreto `ANTHROPIC_API_KEY` en
   https://supabase.com/dashboard/project/anncshionedpjcmjqxiq/functions/secrets
2. (Opcional) Secreto `MODELO` = `claude-haiku-5-5` para abaratar. Por defecto usa `claude-opus-5-5`.

## Uso

`GET /analizar` devuelve las reglas vigentes.

`POST /analizar` con JSON:

```json
{ "codigo_acceso": "JUANKAR-XXXXXX", "imagen": "<JPEG en base64>", "media_type": "image/jpeg", "momento": "cena" }
```

Respuesta: `nombre`, `por_100g`, `semaforo`, `ingredientes`, `nota`, `veredicto`, `plan`, `version_reglas`, `coste_usd`.

Errores: `{ "error": { "codigo", "mensaje" } }` con 400 (foto), 401 (código), 422 (no es comida), 429 (límite diario), 500/502 (configuración o Claude).

## Datos

- `codigos_acceso`: un código por persona, con límite diario de fotos. Para dar acceso a un paciente:
  `insert into codigos_acceso (codigo, nombre, limite_diario) values ('PAC-XXXXXX', 'Nombre', 20);`
- `analisis`: cada resultado (sin la foto), con coste y tiempo. Sirve para el banco de pruebas y el piloto.
- Ambas tablas tienen RLS activado y sin políticas: solo el servidor puede leerlas o escribirlas.

## Reglas

Están en `supabase/functions/analizar/reglas.ts` (versión `2026-11-cdiet-1`). Los valores marcados como supuesto (saturadas, pesos de la nota, frescos, penalizaciones) esperan la validación de la nutricionista. Tras cambiarlas, hay que volver a desplegar la función.
