import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { usePulso } from "./usar-pulso";

/** El pulso de la insignia y del ícono de la barra (OPR-34 §5.2, P-13). */
describe("usePulso", () => {
  it("el primer pintado fija la base y no late, aunque haya una roja", () => {
    const { result } = renderHook(({ ids }) => usePulso(ids), { initialProps: { ids: ["roja-1"] } });
    expect(result.current).toBe(false);
  });

  it("late cuando aparece una roja que no estaba en el pintado anterior", () => {
    const { result, rerender } = renderHook(({ ids }) => usePulso(ids), { initialProps: { ids: ["roja-1"] } });
    rerender({ ids: ["roja-1", "roja-2"] });
    expect(result.current).toBe(true);
  });

  it("no late con una que ya estaba, ni cuando una roja se va", () => {
    const { result, rerender } = renderHook(({ ids }) => usePulso(ids), { initialProps: { ids: ["a", "b"] } });
    rerender({ ids: ["b", "a"] });
    expect(result.current).toBe(false);
    rerender({ ids: ["a"] });
    expect(result.current).toBe(false);
  });

  it("no late con una ámbar: solo se le pasan los ids rojos, así que una lista igual no cambia nada", () => {
    const { result, rerender } = renderHook(({ ids }) => usePulso(ids), { initialProps: { ids: [] as string[] } });
    rerender({ ids: [] });
    expect(result.current).toBe(false);
  });

  it("un pintado igual no apaga un pulso que ya está; el siguiente cambio sin una roja nueva sí", () => {
    const { result, rerender } = renderHook(({ ids }) => usePulso(ids), { initialProps: { ids: [] as string[] } });
    rerender({ ids: ["nueva"] });
    expect(result.current).toBe(true);
    rerender({ ids: ["nueva"] });
    expect(result.current).toBe(true);
    rerender({ ids: [] });
    expect(result.current).toBe(false);
  });

  it("una roja que se fue y vuelve con el mismo id cuenta como nueva si en el pintado anterior no estaba", () => {
    const { result, rerender } = renderHook(({ ids }) => usePulso(ids), { initialProps: { ids: ["x"] } });
    rerender({ ids: [] });
    expect(result.current).toBe(false);
    act(() => rerender({ ids: ["x"] }));
    expect(result.current).toBe(true);
  });
});
