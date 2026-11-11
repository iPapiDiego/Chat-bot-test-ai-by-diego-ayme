# Webhook Rig

Laboratorio de pruebas de chatbots por webhook. Astro 7 (SSR) + Tailwind 4 + Flowbite 4, desplegado en Cloudflare Workers.

## Codebase Memory (MCP) — uso obligatorio

El grafo de conocimiento del repo es la fuente de verdad sobre cómo se compone este proyecto. Úsalo **siempre** antes de explorar con grep, planear o editar; no adivines la estructura ni el impacto de un cambio.

- Servidor: `codebase-memory` (stdio), registrado a nivel de usuario en `~/.commandcode/mcp.json`.
- Proyecto indexado: `Volumes-Kingston-Development-Proyects-Tests-Chat-bot-test-ai-by-diego-ayme`.
- Flujo mínimo de cada tarea:
  1. `list_projects` / `index_status` — confirmar proyecto indexado y frescura.
  2. `get_architecture(aspects=["all"])` — capas, fronteras, hotspots, rutas y clústeres.
  3. `search_graph(name_pattern=...)` → `get_code_snippet(qualified_name=...)` — localizar y leer símbolos.
  4. `trace_path(function_name=..., direction="both", depth=3)` — quién llama y a quién llama.
  5. `detect_changes()` — símbolos afectados por el working tree antes de cerrar un cambio.
  6. `check_index_coverage()` con todas las rutas implicadas — obligatorio antes de afirmar "no existe", "código muerto" o impacto completo.
- Tras crear, mover o borrar archivos, o cambiar firmas: reindexar con `index_repository` (`repo_path`).
- Nivel de evidencia por defecto: **Verify** — búsquedas dirigidas, ambas direcciones del trace, snippet de cada afirmación material y todas las páginas de resultados (`has_more` / `offset`).
- Si el MCP no aparece conectado en la sesión (`/mcp`), usa el mismo servidor por CLI con flags:
  ```bash
  ~/.local/bin/codebase-memory-mcp cli --quiet get_architecture --project <proyecto> --aspects all
  ~/.local/bin/codebase-memory-mcp cli --quiet search_graph --project <proyecto> --name-pattern '.*Callback.*'
  ```
  El JSON crudo como argumento está deprecado; usa flags o `--args-file`.

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

`wrangler.json` define `name`, `compatibility_date`, `compatibility_flags` y el binding KV `CALLBACKS`. Wrangler aprovisiona el namespace al desplegar; si prefieres fijarlo, ejecuta `npx wrangler kv namespace create CALLBACKS` y añade el `id` al binding. El build genera `dist/server/wrangler.json`; no lo edites a mano.

## Arquitectura

- `src/pages/api/probe.ts` es el proxy SSR. Hace la llamada al webhook para evitar CORS y valida el destino contra SSRF (`validateTarget` en `src/lib/webhook.ts`). En `development` permite hosts privados; en producción los bloquea salvo `ALLOW_PRIVATE_TARGETS=true`.
- `src/pages/api/callback/[executionId].ts` recibe la respuesta asíncrona del bot: `POST` valida `executionId` (UUID v4), exige `application/json`, limita el cuerpo a 256 KB y persiste `{receivedAt, payload}` en el binding KV `CALLBACKS` vía `src/lib/callback-store.ts` (clave `callback:<id>`, `expirationTtl` de 10 min); `GET` lo devuelve. `parseJsonBody` reintenta escapando caracteres de control dentro de strings. El almacenamiento vive en KV, no en memoria del isolate: POST y GET pueden caer en isolates distintos. `src/env.d.ts` declara los tipos del binding (los tipos de runtime de `wrangler types` chocan con la lib DOM de Astro).
- `src/lib/webhook.ts` construye payloads (`simple` / `openai`), extrae el texto de respuesta de múltiples formatos y contiene el guard de hosts privados.
- `src/lib/config.ts` maneja el estado del rig y su persistencia en `localStorage`.
- `src/lib/security.ts` define el guard de túnel: `isTunnelRequest` detecta peticiones que no llegan por loopback y `isAllowedTunnelRequest` solo deja pasar `POST` a `/api/callback/<id>`.
- `src/middleware.ts` aplica ese guard a todas las peticiones y responde `404` con `cache-control: no-store` cuando el túnel no está permitido.
- `src/lib/whatsapp.ts` expone `formatWhatsapp`: escapa HTML primero y después inyecta código, enlaces, negritas, cursivas y tachados estilo WhatsApp.
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
