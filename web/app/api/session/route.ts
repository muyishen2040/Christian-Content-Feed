import { handleCreateSession, handleGetSession } from "@/lib/session-api";
import { createSessionDeps } from "@/lib/supabase-server";

export async function GET(): Promise<Response> {
  return handleGetSession(createSessionDeps());
}

export async function POST(request: Request): Promise<Response> {
  return handleCreateSession(request, createSessionDeps());
}
