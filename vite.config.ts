import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    cloudflare(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png"],
      manifest: {
        name: "Mesão Evento",
        short_name: "Mesão",
        description: "Aplicativo operacional dos eventos do Mesão do Amor",
        theme_color: "#244b3a",
        background_color: "#f7f1e8",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png"
          }
        ]
      },
      workbox: {
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,png,svg,ico}"]
      }
    })
  ]
});
