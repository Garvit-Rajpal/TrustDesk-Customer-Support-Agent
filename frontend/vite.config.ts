import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev-time proxy to the TrustDesk API (npm run dev in Solution/, port 3000)
// so the frontend never needs CORS middleware on the backend.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/auth": "http://localhost:3000",
      "/tickets": "http://localhost:3000",
      "/documents": "http://localhost:3000",
      "/agent-runs": "http://localhost:3000",
      "/tool-actions": "http://localhost:3000",
      "/eval-runs": "http://localhost:3000",
      "/users": "http://localhost:3000",
      "/drafts": "http://localhost:3000",
      "/metrics": "http://localhost:3000",
      "/orgs": "http://localhost:3000",
      "/customers": "http://localhost:3000",
      // GET /signup is the frontend's own page route (react-router) — only
      // the actual POST /signup API call should proxy to the backend, so a
      // hard page load / refresh on /signup still serves the SPA shell.
      "/signup": {
        target: "http://localhost:3000",
        bypass: (req) => (req.method === "GET" ? req.url : undefined),
      },
      "/platform": "http://localhost:3000",
      "/embeddings": "http://localhost:3000",
      "/dashboard": "http://localhost:3000",
      // W17 (LLD_v4 §7): public customer-ownership verification.
      "/customer-auth": "http://localhost:3000",
      // W17: the customer-chat WS transport — ws: true so Vite proxies the
      // upgrade request too, not just a plain HTTP one.
      "/customer-chat": {
        target: "http://localhost:3000",
        ws: true,
      },
    },
  },
});
