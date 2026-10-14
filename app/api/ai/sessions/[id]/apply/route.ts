import { aiApi } from "@/lib/server-ai";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { return aiApi(request, "apply", (await params).id); }
