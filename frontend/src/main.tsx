import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import TruApp from "./tru-app";

const el = document.getElementById("root");
if (!el) throw new Error("#root element missing");

createRoot(el).render(
  <StrictMode>
    <TruApp />
  </StrictMode>
);
