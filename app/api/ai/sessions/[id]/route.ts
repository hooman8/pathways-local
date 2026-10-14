import { aiApi } from "@/lib/server-ai";
export const runtime = "nodejs";
export const maxDuration = 1800;
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { return aiApi(request, "get", (await params).id); }
