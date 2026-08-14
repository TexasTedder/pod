import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Local dev: the browser calls same-origin "/api/*" and this proxy forwards
// it to the Neptune backend (Node/Express) - same pattern as Mercury Travel
// Billing. In production the frontend is a standalone IIS site with no
// proxy, so VITE_API_BASE (see .env.production) is baked in at build time
// instead.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: {
      "/api": {
        target: "http://localhost:5051",
        changeOrigin: true,
      },
    },
  },
});
