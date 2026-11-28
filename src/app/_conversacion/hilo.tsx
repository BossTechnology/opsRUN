import { MENSAJE_NO_ENCONTRADO } from "@/lib/conversacion/armar-hilo";
import type { DisponibilidadDelModo } from "@/lib/conversacion/composer";
import type { EntradaDeHilo, ModoComposer } from "@/lib/conversacion/tipos";

type Props = {
  entradas: EntradaDeHilo[];
  /** Los mensajes no se pudieron leer nunca (BzzzBX caído sin lectura previa). */
  mensajesNoDisponibles: boolean;
  /** `Edit and resend`: copia el cuerpo al Composer en el mismo modo. */
  onReenviar: (modo: "customer" | "cleaner", cuerpo: string) => void;
  /**
   * Lo que puede enviar el Composer en cada modo (OPR-19 §6.1 y §6.3): Edit and resend solo se puede pulsar si el modo
   * de su canal está disponible; si no, queda en gris con el mismo motivo. Sin esta prop, todos disponibles.
   */
  modos?: Record<ModoComposer, DisponibilidadDelModo>;
};

/**
 * El hilo del job (spec OPR-27 §4): una sola columna con la request original,
 * los correos, los textos y las notas, cada uno con su color y su estado de
 * entrega. Cada entrada lleva `data-tipo` y `data-direccion` para que las
 * pruebas no dependan del color. Los cuerpos son texto plano (S-5): React los
 * escapa, nunca se interpreta HTML.
 */
export function Hilo({ entradas, mensajesNoDisponibles, onReenviar, modos }: Props) {
  return (
    <div className="hilo-marco">
      {mensajesNoDisponibles ? (
        <p className="hilo-aviso" data-testid="mensajes-no-disponibles" role="status">
          Messages unavailable
        </p>
      ) : null}
      {entradas.length === 0 && !mensajesNoDisponibles ? <p className="hilo-vacio">No messages yet.</p> : null}
      <ol className="hilo" data-testid="hilo" aria-label="Conversation thread">
        {entradas.map((e) => (
          <li
            key={e.id}
            className={`entrada entrada-${e.tipo} entrada-${e.direccion}`}
            data-testid="entrada"
            data-entrada={e.id}
            tabIndex={-1}
            data-tipo={e.tipo}
            data-direccion={e.direccion}
            data-entrega={e.entrega ?? undefined}
          >
            <div className="entrada-cabecera">
              <span className="entrada-etiqueta" data-testid="etiqueta">
                {e.etiqueta}
              </span>
              {e.contraparte ? <span className="entrada-contraparte">{e.contraparte}</span> : null}
              <time className="entrada-hora" dateTime={e.instante}>
                {e.hora}
              </time>
            </div>
            {e.asunto ? <p className="entrada-asunto">{e.asunto}</p> : null}
            {e.noEncontrado ? (
              <p className="entrada-no-encontrada" data-testid="mensaje-no-encontrado">
                {MENSAJE_NO_ENCONTRADO}
              </p>
            ) : (
              <p className="entrada-cuerpo" data-testid="cuerpo">
                {e.cuerpo}
              </p>
            )}
            {e.estado ? (
              <p
                className={`entrada-estado${e.estado.tono === "error" ? " entrada-error" : ""}`}
                data-testid="estado-entrega"
                role={e.estado.tono === "error" ? "status" : undefined}
              >
                {e.estado.texto}
              </p>
            ) : null}
            {e.reenviar ? <Reenviar entrada={e} disponibilidad={modos?.[e.reenviar.modo]} onReenviar={onReenviar} /> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Edit and resend (spec OPR-27 §4.3, OPR-19 §6.1 y §6.3): copia el cuerpo al Composer en el modo del canal. Hereda
 * la disponibilidad de ese modo: con BzzzBX caído, el job cancelado, sin hilo o sin cleaner queda en gris con el
 * mismo motivo. Pulsarlo nunca envía: solo llena el Composer; sale algo si el operador pulsa Send.
 */
function Reenviar({
  entrada,
  disponibilidad,
  onReenviar,
}: {
  entrada: EntradaDeHilo;
  disponibilidad: DisponibilidadDelModo | undefined;
  onReenviar: Props["onReenviar"];
}) {
  const reenviar = entrada.reenviar!;
  const apagado = disponibilidad && !disponibilidad.disponible ? disponibilidad.razon : null;
  return (
    <span className="entrada-reenviar-zona">
      <button
        type="button"
        className="entrada-reenviar"
        data-testid="reenviar"
        disabled={apagado !== null}
        aria-describedby={apagado ? `reenviar-razon-${entrada.id}` : undefined}
        onClick={() => onReenviar(reenviar.modo, reenviar.cuerpo)}
      >
        Edit and resend
      </button>
      {apagado ? (
        <span className="nota-gris" id={`reenviar-razon-${entrada.id}`} data-testid="reenviar-razon">
          {apagado}
        </span>
      ) : null}
    </span>
  );
}
