/** Reloj inyectable: el falso nunca usa temporizadores, avanza con el reloj. */
export interface Reloj {
  ahora(): Date;
}

export const relojDelSistema: Reloj = { ahora: () => new Date() };

/** Para pruebas: el tiempo solo pasa cuando se adelanta. */
export class RelojManual implements Reloj {
  private ms: number;

  constructor(inicio: Date = new Date("2030-01-15T15:00:00Z")) {
    this.ms = inicio.getTime();
  }

  ahora(): Date {
    return new Date(this.ms);
  }

  adelantar(ms: number): void {
    this.ms += ms;
  }
}
