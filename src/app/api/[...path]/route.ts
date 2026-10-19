import { handleApi } from "@/server/http/router";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handler(request: Request): Promise<Response> {
  return handleApi(request);
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
