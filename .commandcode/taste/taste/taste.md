# Taste
- Prefiere comunicarse en español y que las respuestas, la UI y la documentación se escriban en español; corrige explícitamente ("en español") cuando se le responde en inglés, incluso en resúmenes técnicos. Confidence: 0.9
- Quiere que se consulte siempre el MCP `codebase-memory` (grafo de conocimiento) antes de explorar con grep, planear o editar en el proyecto: es su fuente de verdad de cómo se compone el repo. Confidence: 0.85
- Prefiere construir frontends con Tailwind CSS + Flowbite y TypeScript, con despliegue previsto en Cloudflare (Workers/Pages). Confidence: 0.6
- Prefiere entregas concisas: pide un resumen corto al terminar la tarea, sin explicaciones extensas. Confidence: 0.8
- Espera que cada cambio se valide con `npm run check` y `npm run build` con 0 errores antes de reportarlo. Confidence: 0.75
- Prefiere desplegar él mismo por defecto: no ejecutar `deploy`/publicar, sino dejar el código listo y reportar qué se cambió ("no despliegues: dime qué cambiaste y yo lo despliego"); cuando lo pide explícitamente ("despliega al final con `wrangler deploy`"), sí espera el deploy real y la verificación contra el entorno desplegado. Confidence: 0.8
- Prefiere que el JSON se genere con `JSON.stringify`/`Response.json` en lugar de armar strings a mano, y que las respuestas de API sean JSON estrictamente válido y parseable. Confidence: 0.7
- Prefiere la lógica independiente del DOM extraída como funciones puras en `src/lib` (p. ej. `formatWhatsapp`), y que cualquier renderizado HTML escape primero el texto de entrada para que contenido no confiable nunca se ejecute. Confidence: 0.7
