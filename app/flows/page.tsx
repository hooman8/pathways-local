import FlowWorkspace from "@/components/flows/flow-workspace";
import "./flows.css";
export const metadata = { title: "Application flows · Pathways Local" };
export const dynamic = "force-dynamic";
export default async function FlowsPage({ searchParams }: { searchParams: Promise<{ flow?: string }> }) {
  return <FlowWorkspace initialId={(await searchParams).flow} />;
}
