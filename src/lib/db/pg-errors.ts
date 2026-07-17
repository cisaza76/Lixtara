// Shared Postgres error helpers for store adapters (AssetStore, JobsStore, ...).
// A single `UniqueViolationError` class so an `instanceof` check works no matter which
// adapter threw it, plus a canonical `isUniqueViolation` that recognizes a 23505 either
// by instance OR by a raw Postgrest error shape (`{ code: "23505" }`) — so callers never
// need to know whether the error in hand was thrown by a store adapter or came straight
// off a driver/mock result.
export const PG_UNIQUE_VIOLATION = "23505";

export class UniqueViolationError extends Error {
  readonly code = PG_UNIQUE_VIOLATION;
  constructor(message = "unique_violation") {
    super(message);
    this.name = "UniqueViolationError";
  }
}

export function isUniqueViolation(err: unknown): boolean {
  if (err instanceof UniqueViolationError) return true;
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}
