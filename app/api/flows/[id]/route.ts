import { flowsApi } from "@/lib/server-flows";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export const GET = async (request: Request, context: Context) => flowsApi(request, "get", (await context.params).id);
export const PUT = async (request: Request, context: Context) => flowsApi(request, "update", (await context.params).id);
