import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TarjetaSalud } from "./tarjeta-salud";

afterEach(cleanup);

describe("TarjetaSalud", () => {
  it("muestra la base conectada y la versión del esquema", () => {
    render(<TarjetaSalud salud={{ conectada: true, versionEsquema: "20261124000000" }} />);
    expect(screen.getByTestId("estado-base").textContent).toBe("Connected");
    expect(screen.getByTestId("version-esquema").textContent).toBe("20261124000000");
  });

  it("no muestra el detalle del error en la página", () => {
    render(
      <TarjetaSalud salud={{ conectada: false, error: "connect ECONNREFUSED host-interno:5432" }} />,
    );
    expect(screen.getByTestId("estado-base").textContent).toBe("Not connected");
    expect(document.body.textContent).not.toContain("host-interno");
  });
});
