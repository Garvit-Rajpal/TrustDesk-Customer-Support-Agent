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
    },
  },
});
