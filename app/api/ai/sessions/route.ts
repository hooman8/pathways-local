import { aiApi } from "@/lib/server-ai";
export const runtime = "nodejs";
export const maxDuration = 1800;
export const POST = (request: Request) => aiApi(request, "create");
