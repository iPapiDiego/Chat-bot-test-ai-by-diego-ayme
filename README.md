# Webhook Rig

Laboratorio para probar y demostrar chatbots conectados a un webhook. Pegas la URL de tu endpoint, la guardas y conversas con él desde el navegador: sin tocar código, sin recompilar y sin depender de CORS.

Está pensado para demos en vivo con clientes: cambias de endpoint en un clic, guardas varios destinos y muestras la respuesta cruda en el inspector.

## Qué hace

- **Conectar cualquier webhook**: pegas la URL, la guardas y empiezas a enviar mensajes.
- **Proxy en el servidor**: las peticiones salen del backend de la app, así que evitas CORS y funciona con cualquier dominio. También existe el modo directo desde el navegador si tu webhook ya expone CORS.
- **Dos formatos de payload**: `simple` (`{sessionId, message, history, timestamp}`) o `OpenAI chat` (`{model, messages, stream}`).
- **Detección de la respuesta**: reconoce `reply`, `response`, `message`, `answer`, `output`, `choices[]` de OpenAI, texto plano, y permite fijar una ruta manual (`data.reply`).
- **Inspector**: estado HTTP, latencia, content-type, JSON crudo, payload enviado y cabeceras de la conexión.
- **Destinos guardados**: varios endpoints de demo listos para cambiar sin copiar la URL.
- **Historial de conversación** enviado en cada turno.
- **Persistencia local**: la configuración vive en `localStorage`, no en un servidor.

## Requisitos

- Node.js `>= 22.23.4` (Astro 7 lo exige; con `nvm install 24` es suficiente).
- Un webhook que acepte `POST` con JSON.

## Desarrollo local

```bash
npm install
npm run dev
```

Abre `http://localhost:4321`.

En modo desarrollo el proxy permite destinos privados (`localhost`, `127.0.0.1`, redes internas) para que puedas probar contra un webhook en tu máquina.

## Probar con un webhook local

```bash
node -e '
require("node:http").createServer((req,res)=>{
  let b="";req.on("data",c=>b+=c);req.on("end",()=>{
    const {message="",messages=[]}=JSON.parse(b||"{}");
    const last = message || messages.at(-1)?.content || "";
    res.writeHead(200,{"content-type":"application/json"});
    res.end(JSON.stringify({reply:`Eco: ${last}`}));
  });
}).listen(4319,()=>console.log("webhook en http://localhost:4319"));
'
```

Luego, en la app, usa `http://localhost:4319/` con transporte **Proxy**.

## Desplegar en Cloudflare

El proyecto usa `output: "server"` con el adaptador `@astrojs/cloudflare`, así que se despliega como Worker con assets estáticos.

```bash
npx wrangler login   # solo la primera vez
npm run deploy
```

`npm run deploy` compila y publica. El nombre del Worker (`chat-bot-test-ai-by-diego-ayme`) y el binding KV `CALLBACKS` viven en `wrangler.json`. Al terminar te dará una URL `https://chat-bot-test-ai-by-diego-ayme.<tu-subdominio>.workers.dev`.

Los callbacks se guardan en Workers KV (namespace `CALLBACKS`, clave `callback:<executionId>`, TTL de 10 min), no en memoria del isolate: `POST` y `GET` pueden caer en isolates distintos. El binding va **sin `id`** a propósito: Wrangler lo aprovisiona en la cuenta que despliega y luego lo hereda. Los ids de KV son por cuenta, así que fijar uno de otra cuenta rompe el deploy con `KV namespace '<id>' not found [code: 10041]`.

Despliega con `wrangler` desde el repo. Subir `dist/` a mano o crear un proyecto de Pages no funciona: el SSR necesita el Worker con su binding `ASSETS`, que solo genera `wrangler deploy` (o Workers Builds con build `npm run build` y deploy `npx wrangler deploy`).

Otros comandos útiles:

| Comando | Qué hace |
| --- | --- |
| `npm run build` | Typecheck + build de producción |
| `npm run check` | Solo el typecheck |
| `npm run deploy:dry` | Build y empaquetado sin publicar |
| `npm run cf:dev` | Build y ejecuta el Worker en el runtime local de Cloudflare |

### Importante en producción

El proxy **bloquea direcciones privadas** (localhost, `10.x`, `192.168.x`, `172.16-31.x`, `169.254.x`, `::1`, IPv6 internas) para evitar SSRF contra la red interna de Cloudflare. En producción, usa una URL pública.

Si de verdad necesitas apuntar a una red privada desde el deploy, compila con `ALLOW_PRIVATE_TARGETS=true npm run deploy`. Es una variable de build (`import.meta.env`), no una var del Worker en runtime. No la actives en un sitio abierto al público.

El Worker desplegado sirve la UI con normalidad. `src/middleware.ts` solo bloquea peticiones que llegan por un túnel (`*.trycloudflare.com`, o loopback con cabeceras de Cloudflare): ahí únicamente pasa `POST /api/callback/<uuid>` para no exponer el rig.

Alternativa para probar un webhook que solo existe en tu máquina, estando desplegado: cambia el transporte a **Directo** y expón tu servicio con un túnel (por ejemplo `cloudflared tunnel --url http://localhost:4319`). El navegador llamará al túnel público directamente.

## Variables y configuración

No requiere secretos para funcionar. Opcionales:

| Variable | Valor | Efecto |
| --- | --- | --- |
| `ALLOW_PRIVATE_TARGETS` | `true` | Permite que el proxy llame direcciones privadas en producción. Se aplica en build, no como var de runtime |

Los tokens de tus webhooks (por ejemplo `Authorization: Bearer …`) se guardan en el navegador del usuario y viajan en la petición de cada prueba. No se almacenan en el servidor, pero **sí pasan por el proxy**: si el endpoint de demo tiene credenciales sensibles, usa el transporte directo o limita el token.

## Estructura

```text
src/
├── layouts/Layout.astro       # documento base
├── lib/
│   ├── config.ts              # estado, validación de URL, persistencia
│   └── webhook.ts             # payloads, extracción de respuesta, guard SSRF
├── pages/
│   ├── index.astro            # interfaz (config + chat + inspector)
│   └── api/probe.ts           # endpoint proxy POST /api/probe
├── scripts/rig.ts             # lógica cliente del laboratorio
└── styles/global.css          # Tailwind 4 + tema Flowbite + tokens
```

## API del proxy

`POST /api/probe`

```json
{
  "url": "https://tu-webhook.dev/chat",
  "message": "hola",
  "history": [{ "role": "user", "content": "antes" }],
  "payloadMode": "simple",
  "model": "demo",
  "authHeaderName": "Authorization",
  "authHeaderValue": "Bearer …",
  "responsePath": "data.reply",
  "timeoutMs": 30000,
  "sessionId": "sess_x"
}
```

Devuelve `ok`, `status`, `elapsedMs`, `reply`, `raw`, `headers` y `error`. Si el upstream responde con error, el proxy devuelve `502` con el cuerpo crudo, para que el inspector muestre qué pasó realmente.
