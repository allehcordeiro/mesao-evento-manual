import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./styles.css";

const SERVICE_WORKER_CHECK_INTERVAL_MS = 5 * 60 * 1000;

registerSW({
  immediate: true,
  onRegisteredSW(swUrl, registration) {
    if (!registration) return;

    const checkForUpdate = async () => {
      if (!navigator.onLine || registration.installing) return;

      try {
        const response = await fetch(swUrl, {
          cache: "no-store",
          headers: {
            "cache-control": "no-cache"
          }
        });

        if (response.ok) {
          await registration.update();
        }
      } catch {
        // O aplicativo continua funcionando com a versão já armazenada.
      }
    };

    void checkForUpdate();
    window.setInterval(() => void checkForUpdate(), SERVICE_WORKER_CHECK_INTERVAL_MS);
  },
  onRegisterError(error) {
    console.error("Falha ao registrar a atualização offline:", error);
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
