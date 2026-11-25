import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import "@fontsource-variable/figtree/index.css";
import "@fontsource-variable/fraunces/index.css";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <RouterProvider router={getRouter()} />,
);
