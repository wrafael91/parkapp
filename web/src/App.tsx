import { useEffect, useState } from "react";

type ApiStatus = "checking" | "available" | "unavailable";

const STATUS_TEXT: Record<ApiStatus, string> = {
  checking: "comprobando…",
  available: "disponible",
  unavailable: "no disponible",
};

export default function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    // Relative URL: same origin as the page (ADR 0002). In development,
    // Vite forwards /api to the local API; in production, Nginx does.
    const controller = new AbortController();
    fetch("/api/salud", { signal: controller.signal })
      .then((response) => setApiStatus(response.ok ? "available" : "unavailable"))
      .catch(() => {
        if (!controller.signal.aborted) setApiStatus("unavailable");
      });
    return () => controller.abort();
  }, []);

  return (
    <main>
      <h1>RoloPark</h1>
      <p>Servidor: {STATUS_TEXT[apiStatus]}</p>
    </main>
  );
}
