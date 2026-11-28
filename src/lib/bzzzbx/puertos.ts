/**
 * Los dos puertos por los que opsRUN habla con BzzzBX (ADR 0005, spec OPR-22).
 * Toda implementación (el falso en memoria, el real de OPR-6) cumple estas
 * interfaces y pasa las pruebas de `contrato/`.
 */
import type {
  Acuse,
  Cursor,
  Entidad,
  EntidadHija,
  Entidades,
  FiltroDeJobs,
  FiltroDeMensajes,
  Filtros,
  Instruccion,
  ImagenDeFoto,
  Job,
  Leido,
  Message,
  LoteDeCambios,
  LoteDeResultados,
  Resultado,
} from "./tipos";
import type { PedidoDeAnalisis, ResultadoDeAnalisis } from "./tipos-ia";

/**
 * Lectura de las proyecciones. Puede lanzar `BzzzbxNoDisponible` en cualquier
 * llamada, y `CursorCaducado` en `cambiosDesde`.
 */
export interface LecturaBzzzbx {
  /** Una entidad por su crosswalk ID; null si BzzzBX no la conoce. */
  obtener<E extends Entidad>(entidad: E, id: string): Promise<Leido<Entidades[E]> | null>;
  /** Varias por ID, en una sola ida. Las desconocidas no vienen. */
  obtenerVarios<E extends Entidad>(entidad: E, ids: string[]): Promise<Leido<Entidades[E]>[]>;
  /** Por relación: eventos, fotos y asignaciones de un job, mensajes de un hilo, alertas de un sujeto. */
  listarPor<E extends EntidadHija>(entidad: E, filtro: Filtros[E]): Promise<Leido<Entidades[E]>[]>;
  /** Jobs candidatos para enlazar una request en la Fase A (Runbook §6.1). */
  buscarJobs(filtro: FiltroDeJobs): Promise<Leido<Job>[]>;
  /**
   * La imagen de una foto por su `ref` (`Photo.ref`); null si BzzzBX no la conoce.
   * PROVISIONAL hasta OPR-6 y OPR-9 (spec OPR-30 §4.2, P-8). opsRUN nunca la guarda
   * ni la cachea: la sirve tal cual por `/api/fotos/[id]`.
   */
  leerFoto(ref: string): Promise<ImagenDeFoto | null>;
  /**
   * Correos entrantes desde una hora, por páginas (spec OPR-15 §4.3). Para
   * recuperar lo llegado mientras opsRUN estuvo parado o el cursor caducó.
   * PROVISIONAL hasta OPR-6.
   */
  buscarMensajes(filtro: FiltroDeMensajes): Promise<{ mensajes: Leido<Message>[]; hay_mas: boolean }>;
  /**
   * Qué cambió desde el cursor. Con null, ningún cambio y el cursor de ahora.
   * Un cambio dice solo entidad, id y versión: el dato se relee con `obtener`.
   */
  cambiosDesde(cursor: Cursor | null): Promise<LoteDeCambios>;
}

/**
 * Instrucciones a BzzzBX. `entregar` puede lanzar `BzzzbxNoDisponible` (no se
 * entregó: se reintenta con la misma clave) o `InstruccionRechazada`.
 */
export interface InstruccionesBzzzbx {
  /** Idempotente por `idempotency_key`: la misma clave da el mismo acuse y no repite la acción. */
  entregar(instruccion: Instruccion): Promise<Acuse>;
  /** Avances y cierres desde el cursor. Con null, ninguno y el cursor de ahora. */
  resultadosDesde(cursor: Cursor | null): Promise<LoteDeResultados>;
  /** El último resultado de una instrucción; null si BzzzBX no la conoce. */
  estado(idempotency_key: string): Promise<Resultado | null>;
}

/**
 * La capa de IA de BzzzBX (spec OPR-36 §12). PROVISIONAL hasta OPR-6. opsRUN nunca
 * llama a Claude ni manda el cuerpo del correo: pide el análisis con crosswalk IDs
 * y BzzzBX lee el correo y llama a Claude. Asíncrono: pedir y consultar, para que
 * una IA lenta no ocupe la vuelta del ciclo y la clave sobreviva a un reinicio.
 */
export interface IaBzzzbx {
  /**
   * Pide el análisis de una request. Idempotente por `clave` (el ai_analysis.id): la
   * misma clave no repite el trabajo. Puede lanzar BzzzbxNoDisponible, IaRechazada
   * o IaLimitada.
   */
  pedirAnalisis(pedido: PedidoDeAnalisis): Promise<{ recibido_at: string }>;
  /** El estado del análisis de esa clave; null si BzzzBX no la conoce. Un resultado terminado no cambia. */
  resultadoDeAnalisis(clave: string): Promise<ResultadoDeAnalisis | null>;
}

export type Bzzzbx = { lectura: LecturaBzzzbx; instrucciones: InstruccionesBzzzbx; ia: IaBzzzbx };
