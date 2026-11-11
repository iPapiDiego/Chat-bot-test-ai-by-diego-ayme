# Webhook Rig

Laboratorio de pruebas de chatbots por webhook. Astro 7 (SSR) + Tailwind 4 + Flowbite 4, desplegado en Cloudflare Workers.

## Development

Requiere Node `>= 22.23.4` (Astro 7). Si el Node del sistema es menor, usa nvm:

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.22.2
```

Inicia el dev server en segundo plano:

```bash
astro dev --background
```

Gestión: `astro dev stop`, `astro dev status`, `astro dev logs`.

## Validación obligatoria

Antes de dar por terminado un cambio:

```bash
npm run check   # astro check, debe quedar en 0 errores
npm run build   # typecheck + build de producción
```

## Deploy

```bash
npm run deploy      # astro build + wrangler deploy
npm run deploy:dry  # build + empaquetado sin publicar
npm run cf:dev      # build + wrangler dev (runtime real de Cloudflare)
```

`wrangler.json` define `name`, `compatibility_date` y `compatibility_flags`. El build genera `dist/server/wrangler.json`; no lo edites a mano.

## Arquitectura

- `src/pages/api/probe.ts` es el proxy SSR. Hace la llamada al webhook para evitar CORS y valida el destino contra SSRF (`validateTarget` en `src/lib/webhook.ts`). En `development` permite hosts privados; en producción los bloquea salvo `ALLOW_PRIVATE_TARGETS=true`.
- `src/lib/webhook.ts` construye payloads (`simple` / `openai`), extrae el texto de respuesta de múltiples formatos y contiene el guard de hosts privados.
- `src/lib/config.ts` maneja el estado del rig y su persistencia en `localStorage`.
- `src/scripts/rig.ts` es la lógica de UI: transcript, inspector, pestañas, formulario, destinos guardados y estados de carga/error.
- `src/styles/global.css` contiene Tailwind 4, el tema de Flowbite, los tokens de la marca y las clases de componente (`.field`, `.btn-primary`, etc.).

Si añades un idioma de respuesta o cambias la forma del payload, actualiza ambos lados: `buildPayload` en `src/lib/webhook.ts` y los tipos en `src/lib/config.ts`.

## Notas de plataforma

- `output: "server"` y `session: false` en `astro.config.mjs`. Si activas sesiones, el adaptador de Cloudflare pedirá un binding KV.
- Las rutas de API deben declarar `export const prerender = false`.
- Tailwind 4 se integra por `@tailwindcss/vite`, no por el plugin PostCSS antiguo.
- En el dev server de Astro `import.meta.env.DEV` no es fiable para distinguir entornos; usa `MODE`.

## Documentación

- [Astro docs](https://docs.astro.build)
- [Cloudflare adapter](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)
- [Flowbite + Astro](https://flowbite.com/docs/getting-started/astro/)
