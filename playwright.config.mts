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
  // Un solo trabajador: todos los archivos comparten el servidor, su base y el stand-in de
  // BzzzBX (en memoria), y un archivo que lo reinicia o lo cambia pisaría a otro a medias
  // (sobre todo los envíos de la conversación, que tardan hasta un minuto en cerrar).
  workers: 1,
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
    // OPSRUN_ACTOR_DEMO y BZZZBX_MODO=falso: el selector "Acting as" de la Job
    // window existe solo con las dos (y sin OPSRUN_SERVIDOR). OPR-26, P-2.
    env: { ...entornoSupabaseLocal(), BZZZBX_MODO: "falso", OPSRUN_ACTOR_DEMO: "1" },
  },
});
