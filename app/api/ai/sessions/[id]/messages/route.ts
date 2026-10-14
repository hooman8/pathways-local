import { aiApi } from "@/lib/server-ai";
export const runtime = "nodejs";
export const maxDuration = 1800;
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { return aiApi(request, "message", (await params).id); }
