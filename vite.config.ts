import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5178,
    strictPort: true,
    // the sandbox is reached through a port-forward or a proxy hostname,
    // so don't restrict by Host header
    allowedHosts: true,
    hmr: { clientPort: 5178 },
  },
  preview: {
    host: "0.0.0.0",
    port: 5179,
    strictPort: true,
    allowedHosts: true,
  },
  build: { target: "esnext" },
});
