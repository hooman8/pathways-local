import FlowWorkspace from "@/components/flows/flow-workspace";
import "../flows/flows.css";
export const metadata = { title: "Architecture · Pathways Local" };
export const dynamic = "force-dynamic";
export default async function ArchitecturePage({ searchParams }: { searchParams: Promise<{ flow?: string; project?: string; draft?: string }> }) {
  const params = await searchParams;
  return <FlowWorkspace diagramType="architecture" initialId={params.flow} initialProjectId={params.project} initialDraftId={params.draft} />;
}
