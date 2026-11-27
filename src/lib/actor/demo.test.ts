// @vitest-environment node
/**
 * Actor de demo (OPR-26, P-2): el selector "Acting as" existe solo con TRES
 * condiciones a la vez. Si falta cualquiera falla cerrado: no hay selector, la
 * cookie se ignora y no se declara ningún actor. Una prueba por condición,
 * con las otras dos cumplidas, para que cada una falle sola si se quita.
 */
import { describe, expect, it } from "vitest";

import { actorDeLaCookie, actorDemoActivo, COOKIE_ACTOR, type OperadorElegible } from "./demo";

const TODAS = { OPSRUN_ACTOR_DEMO: "1", BZZZBX_MODO: "falso" } as const;

const OPERADORES: OperadorElegible[] = [
  { id: "0a000000-0000-4000-8000-0000000000a1", nombre: "Ops Uno", authUserId: "de000000-0000-4000-8000-0000000000a1" },
  { id: "0a000000-0000-4000-8000-0000000000a2", nombre: "Ops Dos", authUserId: null },
];

describe("actor de demo: las tres condiciones", () => {
  it("con las tres, está activo y la cookie declara al operador elegido", () => {
    expect(actorDemoActivo(TODAS)).toBe(true);
    expect(actorDeLaCookie(TODAS, OPERADORES[0]!.id, OPERADORES)).toEqual({
      tipo: "operador",
      authUserId: "de000000-0000-4000-8000-0000000000a1",
    });
  });

  it.each([
    ["sin OPSRUN_ACTOR_DEMO", { BZZZBX_MODO: "falso" }],
    ["con OPSRUN_ACTOR_DEMO distinto de 1", { OPSRUN_ACTOR_DEMO: "true", BZZZBX_MODO: "falso" }],
    ["con OPSRUN_ACTOR_DEMO vacío", { OPSRUN_ACTOR_DEMO: "", BZZZBX_MODO: "falso" }],
  ])("condición 1, opt-in explícito: %s no hay selector ni actor aunque se cumplan las otras dos", (_caso, env) => {
    expect(actorDemoActivo(env)).toBe(false);
    expect(actorDeLaCookie(env, OPERADORES[0]!.id, OPERADORES)).toBeNull();
  });

  it.each([
    ["sin BZZZBX_MODO", { OPSRUN_ACTOR_DEMO: "1" }],
    ["con BZZZBX_MODO=real", { OPSRUN_ACTOR_DEMO: "1", BZZZBX_MODO: "real" }],
    ["con BZZZBX_MODO inválido", { OPSRUN_ACTOR_DEMO: "1", BZZZBX_MODO: "otro" }],
  ])("condición 2, BZZZBX_MODO=falso: %s no hay selector ni actor aunque se cumplan las otras dos", (_caso, env) => {
    expect(actorDemoActivo(env)).toBe(false);
    expect(actorDeLaCookie(env, OPERADORES[0]!.id, OPERADORES)).toBeNull();
  });

  it("condición 3, sin OPSRUN_SERVIDOR=1: con ella no hay selector ni actor aunque se cumplan las otras dos", () => {
    const env = { ...TODAS, OPSRUN_SERVIDOR: "1" };
    expect(actorDemoActivo(env)).toBe(false);
    expect(actorDeLaCookie(env, OPERADORES[0]!.id, OPERADORES)).toBeNull();
  });
});

describe("actor de demo: la cookie", () => {
  it("sin cookie, con un id desconocido o de un operador sin auth_user_id, no hay actor", () => {
    expect(actorDeLaCookie(TODAS, undefined, OPERADORES)).toBeNull();
    expect(actorDeLaCookie(TODAS, "no-es-un-operador", OPERADORES)).toBeNull();
    expect(actorDeLaCookie(TODAS, OPERADORES[1]!.id, OPERADORES)).toBeNull();
  });

  it("la cookie lleva el id del operador, nunca su auth_user_id", () => {
    expect(COOKIE_ACTOR).toBe("opsrun_actor_demo");
    expect(actorDeLaCookie(TODAS, "de000000-0000-4000-8000-0000000000a1", OPERADORES)).toBeNull();
  });
});
