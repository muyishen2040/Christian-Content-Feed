import { handleStagingCheck } from "@/lib/staging-check";
import { connection } from "next/server";

export async function GET(): Promise<Response> {
  await connection();
  return handleStagingCheck(process.env);
}
