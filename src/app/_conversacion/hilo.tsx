import { MENSAJE_NO_ENCONTRADO } from "@/lib/conversacion/armar-hilo";
import type { EntradaDeHilo } from "@/lib/conversacion/tipos";

type Props = {
  entradas: EntradaDeHilo[];
  /** Los mensajes no se pudieron leer nunca (BzzzBX caído sin lectura previa). */
  mensajesNoDisponibles: boolean;
  /** `Edit and resend`: copia el cuerpo al Composer en el mismo modo. */
  onReenviar: (modo: "customer" | "cleaner", cuerpo: string) => void;
};

/**
 * El hilo del job (spec OPR-27 §4): una sola columna con la request original,
 * los correos, los textos y las notas, cada uno con su color y su estado de
 * entrega. Cada entrada lleva `data-tipo` y `data-direccion` para que las
 * pruebas no dependan del color. Los cuerpos son texto plano (S-5): React los
 * escapa, nunca se interpreta HTML.
 */
export function Hilo({ entradas, mensajesNoDisponibles, onReenviar }: Props) {
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
            data-tipo={e.tipo}
            data-direccion={e.direccion}
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
            {e.reenviar ? (
              <button
                type="button"
                className="entrada-reenviar"
                data-testid="reenviar"
                onClick={() => onReenviar(e.reenviar!.modo, e.reenviar!.cuerpo)}
              >
                Edit and resend
              </button>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
