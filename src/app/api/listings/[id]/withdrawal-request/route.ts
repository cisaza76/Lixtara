// POST /api/listings/[id]/withdrawal-request — pide a la broker el retiro del listing (#134). Body: { reason? }
// No escribe properties: crea la solicitud y la tarea. Ver src/lib/listing-request-route.ts.
import { handleListingRequest } from "@/lib/listing-request-route";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleListingRequest(req, id, "withdrawal");
}
