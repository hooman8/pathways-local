import { flowsApi } from "@/lib/server-flows";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => flowsApi(request, "validate");
