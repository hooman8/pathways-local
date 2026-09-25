import { flowsApi } from "@/lib/server-flows";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => flowsApi(request, "list");
export const POST = (request: Request) => flowsApi(request, "create");
