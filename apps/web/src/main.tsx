import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// Initialize observability before rendering
import { initSentry } from "./lib/sentry";
import { initTracing, shutdownTracing } from "./lib/tracing";

// Initialize Sentry for error tracking
initSentry();

// Initialize OpenTelemetry for distributed tracing
initTracing();

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  shutdownTracing();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
