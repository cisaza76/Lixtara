// Eliminación del Source Video por parte del vendedor. Módulo PURO: sin Supabase, sin
// Storage, sin React, sin reloj. Todo efecto entra por puertos inyectados, igual que
// source-upload-flow / source-audit.
//
// ALCANCE — esto elimina EXCLUSIVAMENTE el source subido por el vendedor. Nunca toca el
// Listing Video generado, ni jobs históricos, ni cuota/grant. La separación no es una
// convención: es estructural, porque la única vía por la que este módulo conoce un asset es
// `resolveCurrent`, que por contrato devuelve solo kind=video + source_type=seller_upload.
//
// SEMÁNTICA — "eliminar" es archivar + liberar bytes, no borrar la fila:
//   1. lifecycle → "archived"  (autoridad de visibilidad; terminal, nada des-archiva)
//   2. objeto de Storage borrado (recupera el espacio)
//   3. fila del Asset y su provenance CONSERVADAS (evidencia y linaje reconstruible)
//   4. activity_log conservado, más un evento explícito de eliminación
//
// ORDEN — archivar SIEMPRE antes de borrar Storage. Al revés, un fallo tras borrar los bytes
// dejaría un asset vivo apuntando a un objeto inexistente: la UI lo mostraría y el worker
// intentaría renderizarlo. Archivar primero hace que el peor caso sea un objeto huérfano que
// la retención recupera después, nunca un source roto pero "vigente".
//
// IDEMPOTENCIA — el segundo DELETE no encuentra source vigente (el archivado ya no resuelve,
// Issue #118) y devuelve `no_source` sin tocar Storage ni auditoría. No hay 500, no hay
// doble evento, no se reintenta el borrado como si fuera una operación nueva.
import type { Asset } from "@/lib/assets/types";

export const VIDEO_SOURCE_REMOVED_ACTION = "creative_studio.video_source_removed";

// Identidad estable del evento (clave de idempotencia). Solo identificadores: ninguna URL
// firmada, token, ruta de Storage ni credencial entra aquí.
export interface RemovalAuditIdentity {
  userId: string; // actor
  listingId: string; // → activity_log.property_id
  assetId: string; // el source eliminado
}

export interface RemovalAuditPort {
  exists(identity: RemovalAuditIdentity): Promise<boolean>;
  insert(entry: RemovalAuditIdentity): Promise<void>;
}

// Resultado del UPDATE condicional. "already_archived" y "not_found" significan que ESTA
// llamada no cambió nada — se distinguen porque solo la primera merece auditoría reparable.
export type ArchiveSourceOutcome = "archived" | "already_archived" | "not_found";

export interface SourceRemovalDeps {
  // Autoridad única (defaultResolveVideoSource): devuelve el source VIGENTE del listing para
  // ese owner, excluyendo archivados. Es también el guard de aislamiento: si el listing no es
  // del usuario o el asset es de otro, aquí no llega nada.
  resolveCurrent(listingId: string, ownerId: string): Promise<Asset | null>;
  // UPDATE condicional (WHERE id + owner_id + lifecycle <> 'archived'). La atomicidad vive en
  // la base de datos, no aquí: dos DELETE concurrentes solo pueden producir un "archived".
  archive(input: { assetId: string; ownerId: string }): Promise<ArchiveSourceOutcome>;
  // Nunca lanza: devuelve si el objeto quedó borrado. Un fallo aquí no invalida la operación.
  deleteObject(bucket: string, path: string): Promise<boolean>;
  audit: RemovalAuditPort;
}

export type SourceRemovalResult =
  | { removed: false; reason: "no_source" }
  | { removed: true; assetId: string; storageDeleted: boolean };

const NO_SOURCE: SourceRemovalResult = { removed: false, reason: "no_source" };

export async function removeCurrentSource(
  deps: SourceRemovalDeps,
  input: { userId: string; listingId: string },
): Promise<SourceRemovalResult> {
  const current = await deps.resolveCurrent(input.listingId, input.userId);
  // Segundo DELETE (o listing sin source): no es un error, es el estado deseado.
  if (!current) return NO_SOURCE;

  const outcome = await deps.archive({ assetId: current.id, ownerId: input.userId });
  // Defensivo: la fila desapareció entre resolver y archivar. Sin flip no se tocan bytes.
  if (outcome === "not_found") return NO_SOURCE;

  // A partir de aquí el source ya es invisible para toda resolución futura.
  const storageDeleted = await deps.deleteObject(current.storageBucket, current.storagePath);

  // Evidencia: SOLO la escribe quien realmente archivó. El UPDATE condicional es el punto de
  // serialización, así que bajo concurrencia exactamente una llamada obtiene "archived" y por
  // tanto se inserta exactamente un evento — sin necesitar un índice único adicional. El
  // `exists` previo cubre el reintento secuencial.
  if (outcome === "archived") {
    const identity: RemovalAuditIdentity = {
      userId: input.userId,
      listingId: input.listingId,
      assetId: current.id,
    };
    if (!(await deps.audit.exists(identity))) await deps.audit.insert(identity);
  }

  return { removed: true, assetId: current.id, storageDeleted };
}
