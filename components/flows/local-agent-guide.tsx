"use client";
import { useState } from "react";
import { Bot, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { type DiagramType } from "@/lib/application-flow";

export default function LocalAgentGuide({ projectId, projectName, diagramType, disabled }: { projectId: string; projectName: string; diagramType: DiagramType; disabled: boolean }) {
  const [open, setOpen] = useState(false), [copied, setCopied] = useState(false), [origin, setOrigin] = useState("");
  const prompt = `Create or refine ${diagramType === "architecture" ? "architecture diagrams" : "complex workflows"} in my Pathways Local project "${projectName}" (project ID ${projectId}).\nThe local app is at ${origin}.\n1. Read GET ${origin}/api/agent for the authoring schema, instructions, and capabilities.\n2. Read GET ${origin}/api/agent/project?projectId=${encodeURIComponent(projectId)} for all current definitions, revisions, and saved order. Read existing diagrams before changing them.\n3. Follow my requirements. Preserve unrelated diagrams, IDs, internal detail links, presenter notes, and the full project order. Set diagramType to ${diagramType} for this proposal. For complex designs, use an overview and linked detail diagrams.\n4. Submit POST ${origin}/api/agent/proposals with a fresh UUID requestId (retain for retries), projectId, diagramType, the exact saved base array, and proposal conforming to proposalSchema. Local writes require Content-Type: application/json, X-Pathways-Client: 1, and Origin: ${origin}.\n5. Return the reviewUrl so I can inspect and Apply the draft in Pathways. A proposal does not change saved diagrams. Do not Apply until I have requested it.\nNo Pathways API key is required. Keep credentials and exported project data out of source control.`;
  return <>
    <Button variant="ghost" disabled={disabled || !projectId} onClick={() => { setOrigin(window.location.origin); setCopied(false); setOpen(true); }}><Bot size={15} />Use a local agent</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="flow-agent-guide"><DialogHeader><DialogTitle>Connect your local agent</DialogTitle><DialogDescription>Give these instructions and your design requirements to an agent on this computer. It can create linked workflows or architecture without a Pathways AI subscription.</DialogDescription></DialogHeader>
      <textarea readOnly aria-label="Instructions for your local agent" value={prompt} rows={12} />
      <Button onClick={async () => { try { await navigator.clipboard.writeText(prompt); setCopied(true); } catch { setCopied(false); } }}><Copy size={15} />{copied ? "Copied" : "Copy agent instructions"}</Button>
      <p>Agents can also use the CLI in your Pathways Local checkout: <code>npm run agent -- capabilities</code>. Add <code>--url {origin}</code> when using a different port.</p>
      <p>Agent proposals appear as drafts with a review link. Applying saves all proposed diagrams and their order together; stale revisions are rejected.</p>
    </DialogContent></Dialog>
  </>;
}
