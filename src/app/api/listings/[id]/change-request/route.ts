// POST /api/listings/[id]/change-request — pide a la broker un cambio en un listing ya enviado (#136). Body: { changes: { campo: valor }, reason? }
// No escribe properties: crea la solicitud y la tarea. Ver src/lib/listing-request-route.ts.
import { handleListingRequest } from "@/lib/listing-request-route";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleListingRequest(req, id, "change");
}
