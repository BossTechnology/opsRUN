import { defineConfig, devices } from "@playwright/test";

// Compartido con `pnpm local`.
import { entornoSupabaseLocal } from "./scripts/supabase-local.mjs";

const PUERTO = 3100;
const enCI = Boolean(process.env.CI);

// E2E contra el build de producción (lo mismo que se despliega), conectado al
// Supabase local. Requiere `supabase start` antes; el servidor deja la base
// lista (alta local y migraciones) antes del build.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: enCI,
  retries: enCI ? 2 : 0,
  reporter: enCI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PUERTO}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm db:prepare && pnpm build && pnpm start --port ${PUERTO}`,
    url: `http://127.0.0.1:${PUERTO}`,
    reuseExistingServer: !enCI,
    timeout: 180_000,
    env: entornoSupabaseLocal(),
  },
});
