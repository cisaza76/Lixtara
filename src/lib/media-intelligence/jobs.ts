// src/lib/media-intelligence/jobs.ts
// Persistence helpers over media_agent_jobs. The caller passes a supabase
// client (service client from the route). Structural JobDbClient keeps these
// unit-testable with a fake.
import type { MediaJobStatus, StrategyPayload } from "@/lib/media-intelligence/types";

// Structural subset of the supabase client we rely on.
export interface JobDbClient {
  from(table: string): {
    insert(row: unknown): {
      select(cols?: string): { single(): Promise<{ data: { id: string } | null; error: unknown }> };
    };
    update(patch: unknown): { eq(col: string, val: string): Promise<{ error: unknown }> };
    select(cols?: string): {
      eq(col: string, val: string): {
        order(col: string, opts: { ascending: boolean }): {
          limit(n: number): {
            maybeSingle(): Promise<{ data: unknown; error: unknown }>;
          };
        };
      };
    };
  };
}

const TABLE = "media_agent_jobs";

export async function createJob(
  db: JobDbClient,
  input: { propertyId: string; ownerId: string },
): Promise<string> {
  const { data, error } = await db
    .from(TABLE)
    .insert({
      property_id: input.propertyId,
      owner_id: input.ownerId,
      status: "pending" as MediaJobStatus,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error("media_agent_jobs insert failed");
  return data.id;
}

export async function setJobStatus(
  db: JobDbClient,
  jobId: string,
  status: MediaJobStatus,
): Promise<void> {
  await db
    .from(TABLE)
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", jobId);
}

export async function completeJob(
  db: JobDbClient,
  jobId: string,
  payload: StrategyPayload,
  providers: string,
): Promise<void> {
  await db
    .from(TABLE)
    .update({
      status: "completed" as MediaJobStatus,
      strategy: payload,
      providers,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

export async function failJob(
  db: JobDbClient,
  jobId: string,
  error: string,
): Promise<void> {
  await db
    .from(TABLE)
    .update({
      status: "failed" as MediaJobStatus,
      error,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}
