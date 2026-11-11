// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  output: "server",
  session: false,
  adapter: cloudflare({
    imageService: "compile",
  }),
  vite: {
    plugins: [tailwindcss()],
    // El control de acceso vive en src/middleware.ts: solo POST /api/callback/<uuid>
    // pasa cuando la peticion llega por tunel. Aceptamos cualquier Host en dev.
    server: {
      allowedHosts: true,
    },
  },
  devToolbar: {
    enabled: false,
  },
});
