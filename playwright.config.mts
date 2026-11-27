import { defineConfig, devices } from "@playwright/test";

// Compartido con `pnpm local`.
import { entornoSupabaseLocal } from "./scripts/supabase-local.mjs";

const PUERTO = 3100;
// Los E2E que escriben (el Audit de OPR-35 hace las llamadas del enlace de la
// Fase A) se conectan como opsrun_app, con la misma URL que usa el servidor.
// Los workers heredan el entorno de este proceso.
process.env.OPSRUN_DATABASE_URL ??= entornoSupabaseLocal().OPSRUN_DATABASE_URL;
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
  projects: [
    { name: "chromium", testIgnore: /(audit|assign-confirm)\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    // La pestaña Audit enlaza R7 (una vez por base): corre después del resto, no a la vez (OPR-35).
    { name: "chromium-audit", testMatch: /audit\.spec\.ts/, dependencies: ["chromium"], use: { ...devices["Desktop Chrome"] } },
    // Assign y Confirm enlazan R8 (una vez por base) y mueven el dueño de R2: también después del resto (OPR-28).
    {
      name: "chromium-assign",
      testMatch: /assign-confirm\.spec\.ts/,
      dependencies: ["chromium-audit"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm db:prepare && pnpm build && pnpm start --port ${PUERTO}`,
    url: `http://127.0.0.1:${PUERTO}`,
    reuseExistingServer: !enCI,
    timeout: 180_000,
    // OPSRUN_ACTOR_DEMO y BZZZBX_MODO=falso: el selector "Acting as" de la Job
    // window existe solo con las dos (y sin OPSRUN_SERVIDOR). OPR-26, P-2.
    // OPSRUN_ZONA_HORARIA fija las horas del Audit (OPR-35, §10.3).
    env: { ...entornoSupabaseLocal(), BZZZBX_MODO: "falso", OPSRUN_ACTOR_DEMO: "1", OPSRUN_ZONA_HORARIA: "America/New_York" },
  },
});
