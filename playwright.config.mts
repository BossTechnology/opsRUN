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
    { name: "chromium", testIgnore: /(audit|assign-confirm|entrada-correo|etapas|alertas|entrega)\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    // La pestaña Audit enlaza R7 (una vez por base): corre después del resto, no a la vez (OPR-35).
    { name: "chromium-audit", testMatch: /audit\.spec\.ts/, dependencies: ["chromium"], use: { ...devices["Desktop Chrome"] } },
    // Assign y Confirm enlazan R8 (una vez por base) y mueven el dueño de R2: también después del resto (OPR-28).
    {
      name: "chromium-assign",
      testMatch: /assign-confirm\.spec\.ts/,
      dependencies: ["chromium-audit"],
      use: { ...devices["Desktop Chrome"] },
    },
    // La entrada de correo crea requests de verdad en la base (OPR-15): también después del resto.
    {
      name: "chromium-entrada",
      testMatch: /entrada-correo\.spec\.ts/,
      dependencies: ["chromium-assign"],
      use: { ...devices["Desktop Chrome"] },
    },
    // Las etapas llevan R8 de Scheduled a Paid y aprueban R5 (una vez por base): después de Assign y Confirm, que enlazan R8, y de la entrada de correo (OPR-30 a OPR-32).
    {
      name: "chromium-etapas",
      testMatch: /etapas\.spec\.ts/,
      dependencies: ["chromium-entrada"],
      use: { ...devices["Desktop Chrome"] },
    },
    // Alerts resuelve alertas de R1, R3, R4 y R9 una vez por base (E2E-2 a E2E-7, OPR-34): después de Audit, Assign y las etapas, que no cierran las de la seed.
    {
      name: "chromium-alertas",
      testMatch: /alertas\.spec\.ts/,
      dependencies: ["chromium-etapas"],
      use: { ...devices["Desktop Chrome"] },
    },
    // El estado de entrega cambia R2 (OPR-19): sus mensajes, el cleaner Team Alpha y las alertas de mensaje que el registrador anota. Después de la conversación y de Alerts.
    {
      name: "chromium-entrega",
      testMatch: /entrega\.spec\.ts/,
      dependencies: ["chromium-alertas"],
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
