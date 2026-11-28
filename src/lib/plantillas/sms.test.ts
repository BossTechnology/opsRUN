// @vitest-environment node
/** `contarSms` (spec OPR-18 §4.4 y §10.2): GSM-7 a 160, UCS-2 a 70, y nueve caracteres que valen dos. */
import { describe, expect, it } from "vitest";

import { contarSms } from "./sms";

describe("contarSms", () => {
  it("vacío: cero mensajes", () => {
    expect(contarSms("")).toEqual({ caracteres: 0, mensajes: 0, gsm7: true });
  });

  it("160 caracteres GSM-7 son un SMS y 161 son dos", () => {
    expect(contarSms("a".repeat(160))).toEqual({ caracteres: 160, mensajes: 1, gsm7: true });
    expect(contarSms("a".repeat(161))).toEqual({ caracteres: 161, mensajes: 2, gsm7: true });
    // Concatenados caben 153 por mensaje.
    expect(contarSms("a".repeat(306)).mensajes).toBe(2);
    expect(contarSms("a".repeat(307)).mensajes).toBe(3);
  });

  it("con un carácter fuera de GSM-7 pasa a UCS-2: 70 y 71", () => {
    const con = (n: number) => "a".repeat(n - 1) + "→";
    expect(contarSms(con(70))).toEqual({ caracteres: 70, mensajes: 1, gsm7: false });
    expect(contarSms(con(71))).toEqual({ caracteres: 71, mensajes: 2, gsm7: false });
  });

  it("las comillas y los guiones tipográficos sacan el texto de GSM-7", () => {
    expect(contarSms("It’s fine").gsm7).toBe(false);
    expect(contarSms("A — B").gsm7).toBe(false);
    expect(contarSms("It's fine - \"ok\"").gsm7).toBe(true);
  });

  it.each(["{", "}", "[", "]", "~", "^", "\\", "|", "€"])("%s es de GSM-7 y vale dos", (c) => {
    expect(contarSms(c)).toEqual({ caracteres: 2, mensajes: 1, gsm7: true });
    // 80 de dos unidades son 160: un SMS; 81, dos.
    expect(contarSms(c.repeat(80)).mensajes).toBe(1);
    expect(contarSms(c.repeat(81)).mensajes).toBe(2);
  });

  it("un emoji (dos unidades UTF-16) cuenta por sus dos unidades en UCS-2", () => {
    expect(contarSms("😀")).toEqual({ caracteres: 2, mensajes: 1, gsm7: false });
  });

  it("los acentos del alfabeto básico no lo sacan de GSM-7", () => {
    expect(contarSms("café ñandú Å").gsm7).toBe(false); // la ú no está en GSM-7
    expect(contarSms("café ñ Å é ù ü").gsm7).toBe(true);
    expect(contarSms("í").gsm7).toBe(false);
  });

  it("el salto de línea es de GSM-7", () => {
    expect(contarSms("a\nb")).toEqual({ caracteres: 3, mensajes: 1, gsm7: true });
  });
});
