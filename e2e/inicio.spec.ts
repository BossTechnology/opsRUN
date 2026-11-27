import { readdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

// La última migración se descubre desde el disco: si alguien agrega una y no
// la aplica en la base local, este test lo dice.
function ultimaMigracion(dirTests: string): string {
  const versiones = readdirSync(join(dirTests, "..", "supabase", "migrations"))
    .map((archivo) => /^(\d{14})_.+\.sql$/.exec(archivo)?.[1])
    .filter((version): version is string => Boolean(version))
    .sort();
  const ultima = versiones.at(-1);
  if (!ultima) throw new Error("No hay migraciones en supabase/migrations");
  return ultima;
}

test("la página de salud lee la salud de su Supabase", async ({ page }) => {
  const esperada = ultimaMigracion(test.info().project.testDir);

  await page.goto("/salud");

  await expect(page.getByRole("heading", { level: 1, name: "opsRUN" })).toBeVisible();
  await expect(page.getByTestId("estado-base")).toHaveText("Connected");
  await expect(page.getByTestId("version-esquema")).toHaveText(esperada);
});
