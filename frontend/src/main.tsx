import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import "./tailwind.css";
import "./design-system/tokens.css";
import "./design-system/design-system.css";
import "./App.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
