import { defineConfig } from "@playwright/test";
const base = process.env.SCHWARM_URL ?? "http://127.0.0.1:4180/";
export default defineConfig({
  workers: 1,
  testDir: "tests/browser",
  timeout: 60000,
  use: {
    baseURL: base,
    viewport: { width: 844, height: 390 },
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
  webServer: process.env.SCHWARM_URL
    ? undefined
    : {
        command: "npm run build && npx vite preview --host 127.0.0.1 --port 4180 --strictPort",
        url: "http://127.0.0.1:4180/",
        reuseExistingServer: true,
        timeout: 120000,
      },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
