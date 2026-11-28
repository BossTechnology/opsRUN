/**
 * Contar mensajes SMS (spec OPR-18 §4.4). Solo informa: el límite de envío sigue siendo el del Composer (1 600) y
 * Send no se bloquea por esto (P-8).
 *
 * GSM-7: un SMS son 160 caracteres (153 por mensaje si el texto se parte); `{ } [ ] ~ ^ \ | €` valen dos. Con un solo
 * carácter fuera del alfabeto el texto pasa a UCS-2: 70 (67 por mensaje).
 */

/** El alfabeto básico de GSM 03.38. */
const BASICO = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
/** La tabla de extensión: cada uno ocupa dos. */
const EXTENSION = new Set("^{}\\[~]|€");

export type ConteoSms = { caracteres: number; mensajes: number; gsm7: boolean };

export function contarSms(texto: string): ConteoSms {
  if (texto === "") return { caracteres: 0, mensajes: 0, gsm7: true };
  let unidades = 0;
  let gsm7 = true;
  for (const c of texto) {
    if (BASICO.has(c)) unidades += 1;
    else if (EXTENSION.has(c)) unidades += 2;
    else {
      gsm7 = false;
      break;
    }
  }
  if (gsm7) return { caracteres: unidades, mensajes: unidades <= 160 ? 1 : Math.ceil(unidades / 153), gsm7 };
  // UCS-2 cuenta unidades UTF-16: un emoji son dos.
  const caracteres = texto.length;
  return { caracteres, mensajes: caracteres <= 70 ? 1 : Math.ceil(caracteres / 67), gsm7 };
}
