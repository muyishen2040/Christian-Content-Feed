import { handleGetConsent, handlePutConsent } from "@/lib/session-api";
import { createSessionDeps } from "@/lib/supabase-server";

export async function GET(): Promise<Response> {
  return handleGetConsent(createSessionDeps());
}

export async function PUT(request: Request): Promise<Response> {
  return handlePutConsent(request, createSessionDeps());
}
