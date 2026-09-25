import FlowWorkspace from "@/components/flows/flow-workspace";
import "./flows.css";
export const metadata = { title: "Application flows · Pathways Local" };
export const dynamic = "force-dynamic";
export default async function FlowsPage({ searchParams }: { searchParams: Promise<{ flow?: string; project?: string }> }) {
  const params = await searchParams;
  return <FlowWorkspace initialId={params.flow} initialProjectId={params.project} />;
}
