import {
  handleDeleteProfile,
  handleGetProfile,
  handlePutProfile,
} from "@/lib/profile-api";
import { createProfileDeps } from "@/lib/profile-server";

export async function GET(): Promise<Response> {
  return handleGetProfile(createProfileDeps());
}

export async function PUT(request: Request): Promise<Response> {
  return handlePutProfile(request, createProfileDeps());
}

export async function DELETE(request: Request): Promise<Response> {
  return handleDeleteProfile(request, createProfileDeps());
}
