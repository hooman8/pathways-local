"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, MessageSquarePlus, RefreshCw, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { providerLabel, sessionProvider, type AiSession, type AiProvider, type AiProviderOption } from "@/lib/ai-authoring";
import { diagramTypeOf, type DiagramType, type FlowSummary } from "@/lib/application-flow";
import FlowCanvas from "./flow-canvas";
import AiSettings from "./ai-settings";

type AiResponse = { session: AiSession; enabled?: boolean; providers?: AiProviderOption[] };
const headers = { "Content-Type": "application/json", "X-Pathways-Client": "1" };
class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
async function api(path: string, body?: unknown) {
  const response = await fetch(`/api/ai/sessions${path}`, { method: body === undefined ? "GET" : "POST", headers, cache: "no-store", signal: AbortSignal.timeout(200_000), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error || "Could not complete this AI request.", response.status);
  return data as AiResponse;
}
export default function AiAuthoring({ projectId, projectName, disabled, flows, onApplied, diagramType = "workflow", initialSessionId }: {
  projectId: string; projectName: string; disabled: boolean; flows: FlowSummary[]; onApplied: (id: string) => Promise<void>; diagramType?: DiagramType; initialSessionId?: string;
}) {
  const architecture = diagramType === "architecture";
  const [open, setOpen] = useState(false), [session, setSession] = useState<AiSession | null>(null);
  const [providers, setProviders] = useState<AiProviderOption[]>([]);
  const [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [message, setMessage] = useState(""), [selectedFlow, setSelectedFlow] = useState(""), [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"diagram" | "steps" | "notes">("diagram");
  const pending = useRef<{ requestId: string; message: string; revision: number } | null>(null);
  const mounted = useRef(true);
  const key = `pathways.ai.${projectId}${architecture ? ".architecture" : ""}`;
  const working = busy || loading || session?.status === "generating";
  const proposal = session?.proposal;
  const modelLabel = providerLabel(session ? sessionProvider(session) : "openai");
  const preview = proposal?.flows.find(flow => flow.id === selectedFlow) ?? proposal?.flows[0];
  const step = preview?.nodes.find(node => node.id === selectedStep);
  const sessionId = session?.id, sessionStatus = session?.status;
  const agentDraft = session?.provider === "agent";
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const accept = useCallback((data: AiResponse) => {
    if (!mounted.current) return;
    setSession(current => current && current.id === data.session.id && current.revision > data.session.revision ? current : data.session);
    if (data.enabled !== undefined) setEnabled(data.enabled);
    if (data.providers) setProviders(data.providers);
    try { sessionStorage.setItem(key, data.session.id); } catch { /* Storage can be disabled; server session still exists. */ }
  }, [key]);
  async function start(fresh = false, provider?: AiProvider) {
    setOpen(true); setLoading(true); setError("");
    try {
      let id = fresh ? null : session?.id;
      if (!fresh && !id) { try { id = sessionStorage.getItem(key); } catch { /* No browser storage. */ } }
      if (id) {
        try { const saved = await api(`/${id}`); if (diagramTypeOf(saved.session) === diagramType) { accept(saved); return; } }
        catch (error) { if (!(error instanceof ApiError) || error.status !== 404) throw error; }
      }
      accept(await api("", { projectId, diagramType, sessionId: crypto.randomUUID(), ...(provider ? { provider } : {}) }));
      pending.current = null; setMessage(""); setSelectedStep(null); setSelectedFlow("");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not open AI authoring."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    if (!initialSessionId || !projectId) return;
    let active = true;
    void api(`/${initialSessionId}`).then(data => {
      if (!active) return;
      if (data.session.projectId !== projectId) throw new Error("This draft belongs to another project.");
      accept(data); setOpen(true);
    }).catch(error => { if (active) { setError(error instanceof Error ? error.message : "Could not load this draft."); setOpen(true); } });
    return () => { active = false; };
  }, [initialSessionId, projectId, accept]);
  useEffect(() => {
    if (!open || !sessionId || sessionStatus !== "generating") return;
    let active = true;
    const timer = setInterval(() => {
      void api(`/${sessionId}`).then(data => { if (active) setSession(current => current && current.revision > data.session.revision ? current : data.session); }).catch(() => { /* Original request or Reload will show errors. */ });
    }, 2500);
    return () => { active = false; clearInterval(timer); };
  }, [open, sessionId, sessionStatus]);
  async function send() {
    if (!session || working || !message.trim()) return;
    const content = message.trim();
    if (!pending.current || pending.current.message !== content) pending.current = { requestId: crypto.randomUUID(), revision: session.revision, message: content };
    setBusy(true); setError("");
    try {
      accept(await api(`/${session.id}/messages`, pending.current));
      pending.current = null; setMessage(""); setSelectedStep(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not generate a draft. Your message is kept.");
      try { const data = await api(`/${session.id}`); accept(data); if (data.session.lastRequestId === pending.current?.requestId) { setMessage(""); pending.current = null; } else if (error instanceof ApiError && error.status === 409) pending.current = null; } catch { /* Keep the same request ID for a safe retry. */ }
    } finally { setBusy(false); }
  }
  async function apply() {
    if (!session || !proposal || working) return;
    setBusy(true); setError("");
    try {
      const data = await api(`/${session.id}/apply`, { revision: session.revision, proposalId: proposal.id }); accept(data);
      await onApplied(proposal.flowOrder.find(id => proposal.flows.some(flow => flow.id === id)) ?? proposal.flowOrder[0]);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not apply. Your draft is kept for retry."); }
    finally { setBusy(false); }
  }
  return <>
    <Button className="flow-ai-launch" disabled={disabled || !projectId} onClick={() => void start()}><Sparkles size={15} />Build with AI</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="flow-ai-dialog"><DialogHeader>
      <DialogTitle><Sparkles size={18} />{architecture ? "Build architecture with AI" : "Build with AI"} <span>{projectName}</span></DialogTitle>
      <DialogDescription>{architecture ? "Describe your app's components, technologies, and connections. Review the architecture draft, refine it, then apply it to this project." : "Describe your process and refine it with AI. Review the draft, then apply it to this project."}</DialogDescription>
    </DialogHeader>
      <div className="flow-ai-body">
        <section className="flow-ai-chat" aria-label="AI conversation">
          <div className="flow-ai-chat-actions"><Button size="sm" variant="ghost" disabled={!!working} onClick={() => void start(true)}><MessageSquarePlus size={14} />New conversation</Button><Button size="icon" variant="ghost" aria-label="Reload AI conversation" disabled={busy || loading} onClick={() => void start()}><RefreshCw size={14} /></Button></div>
          {agentDraft ? <p className="flow-ai-provider">Local agent draft · Review the proposal and Apply to project.</p> : <label className="flow-ai-provider">AI model<select aria-label="AI model" value={session ? sessionProvider(session) : "openai"} disabled={!!working} onChange={event => void start(true, event.target.value as AiProvider)}>{providers.map(option => <option key={option.id} value={option.id}>{option.label} · {option.model}{option.enabled ? "" : " (not configured)"}</option>)}</select><span>Astra uses your own OpenAI API key.</span></label>}
          <div className="flow-ai-messages" role="log" aria-label="Conversation messages" aria-live="polite">
            {!session?.messages.length && <div className="flow-ai-intro"><h3>{architecture ? "Start with your application." : "Start with the business process."}</h3><p>{architecture ? "Include the frontend, backend services, APIs, databases, queues, external integrations, and where each component runs." : "Include who is involved, what starts the flow, decisions, timing, and what happens when something goes wrong."}</p><p>{architecture ? "For example: “A React frontend calls a Node.js API on Cloud Run. The API stores data in PostgreSQL, uses Redis for caching, and publishes jobs to a queue for a background worker.”" : "For example: “A manager approves a request, security reviews it, and access expires at the approved end time.”"}</p></div>}
            {session?.messages.map((item, i) => <div key={i} className={`flow-ai-message ${item.role}`}><strong>{item.role === "user" ? "You" : modelLabel}</strong><p>{item.content}</p></div>)}
            {!!session?.questions.length && <p className="flow-ai-questions">Answer {modelLabel}’s questions below to continue the draft.</p>}
            {working && <p role="status" className="flow-ai-working"><LoaderCircle size={15} className="animate-spin" />{loading ? "Opening conversation…" : `${modelLabel} is reading and validating your flows…`}</p>}
          </div>
          {(error || session?.error) && <p className="flow-ai-error" role="alert">{error || session?.error}</p>}
          {!loading && !enabled && !agentDraft && <div className="flow-ai-error">Connect your OpenAI API key to use Astra. <AiSettings onChanged={() => void start()} /></div>}
          {!agentDraft && <form className="flow-ai-compose" onSubmit={event => { event.preventDefault(); void send(); }}>
            <Textarea aria-label={architecture ? "Describe your app architecture or requested changes" : "Describe your flow or requested changes"} placeholder={architecture ? "Describe your app, its components, and how they connect…" : "Describe your flow, answer a question, or request a change…"} maxLength={8000} value={message} disabled={!!working || !enabled} onChange={event => setMessage(event.target.value)} />
            <div><span>{message.length.toLocaleString()} / 8,000</span><Button type="submit" disabled={!!working || !enabled || !message.trim()}><Send size={14} />{proposal ? "Refine draft" : `Send to ${modelLabel}`}</Button></div>
          </form>}
          <p className="flow-ai-disclosure">{agentDraft ? "This draft was submitted by your local agent." : "Astra sends this conversation and this project’s diagram definitions to OpenAI using your API key."} Drafts stay on this computer until applied. {architecture ? "Architecture drafts describe your system design." : "The diagram does not execute the process."}</p>
        </section>
        <section className="flow-ai-review" aria-label="AI draft review">
          {!proposal ? <div className="flow-ai-empty"><Sparkles size={30} /><h3>Your {architecture ? "architecture" : "flow"} preview will appear here.</h3><p>{architecture ? "AI can create grouped component diagrams with labeled connections, or refine an existing architecture." : "AI can create an overview and linked detail flows, or propose changes to existing flows."}</p></div> : <>
            <div className="flow-ai-review-heading"><div><h3>{session?.status === "applied" ? "Applied to project" : "Review proposed changes"}</h3><p>{proposal.changes.filter(item => item.kind === "create").length} new · {proposal.changes.filter(item => item.kind === "update").length} updated · {proposal.flows.reduce((n, flow) => n + flow.nodes.length, 0)} {architecture ? "components" : "steps"}</p></div><Button onClick={() => void apply()} disabled={!!working || session?.status !== "ready"}><Check size={15} />{session?.status === "applied" ? "Applied" : "Apply to project"}</Button></div>
            {!!proposal.assumptions.length && <details className="flow-ai-assumptions" open><summary>Assumptions to review</summary><ul>{proposal.assumptions.map(item => <li key={item}>{item}</li>)}</ul></details>}
            {proposal.warnings.map(warning => <p className="flow-ai-notice" key={warning}>{warning}</p>)}
            <label className="flow-ai-preview-select">Preview {architecture ? "architecture" : "flow"}<select value={preview?.id ?? ""} onChange={event => { setSelectedFlow(event.target.value); setSelectedStep(null); }}>{proposal.flows.map(flow => <option value={flow.id} key={flow.id}>{flow.name}</option>)}</select></label>
            {preview && <>
              <div className="flow-view-tabs"><button aria-pressed={previewMode === "diagram"} onClick={() => setPreviewMode("diagram")}>Diagram preview</button><button aria-pressed={previewMode === "steps"} onClick={() => setPreviewMode("steps")}>{architecture ? "Component details" : "Step details"}</button><button aria-pressed={previewMode === "notes"} onClick={() => setPreviewMode("notes")}>Presenter notes</button></div>
              <div className="flow-ai-preview">{previewMode === "diagram" ? <FlowCanvas flow={preview} phase="" selected={selectedStep} onSelect={setSelectedStep} /> : previewMode === "notes" ? <section className="flow-ai-presenter-notes" aria-label={`${preview.name} proposed write-up`}><p className="flow-ai-notes-help">Saved with this flow and included in exports to the local edition.</p><div>{preview.presentationNotes?.trim() ? preview.presentationNotes : "This older draft has no write-up. Ask AI to add presenter notes before applying."}</div></section> : <ol className="flow-ai-step-details">{preview.nodes.map(node => <li key={node.id}><strong>{node.title}</strong><small>{node.kind} · {node.actor || node.phase}</small><p>{node.description}</p>{node.timer && <p>Timing: {node.timer.expression}</p>}{node.checks.map(check => <p key={check}>• {check}</p>)}<ul>{preview.edges.filter(edge => edge.source === node.id).map(edge => <li key={edge.id}>{edge.label || "Next"} → {preview.nodes.find(node => node.id === edge.target)?.title}{edge.retry && ` (${edge.retry.maxAttempts} attempts; ${edge.retry.backoff})`}</li>)}</ul></li>)}</ol>}</div>
              {step && previewMode === "diagram" && <div className="flow-ai-selected-step"><strong>{step.title}</strong><p>{step.description}</p>{step.timer && <p>Timing: {step.timer.expression}</p>}{step.checks.map(check => <p key={check}>• {check}</p>)}{step.subflowId && proposal.flows.some(flow => flow.id === step.subflowId) && <Button variant="outline" size="sm" onClick={() => { setSelectedFlow(step.subflowId!); setSelectedStep(null); }}>Preview linked flow</Button>}</div>}
            </>}
            <details className="flow-ai-changes"><summary>Changes and saved order</summary>{proposal.changes.map(change => <div key={change.id}><strong>{change.kind === "create" ? "Create" : "Update"}: {change.name}</strong><p>Connections: {change.connectionsBefore} → {change.connectionsAfter}</p>{change.addedSteps.length > 0 && <p>Added steps: {change.addedSteps.join(", ")}</p>}{change.changedSteps.length > 0 && <p>Changed steps: {change.changedSteps.join(", ")}</p>}{change.removedSteps.length > 0 && <p>Removed steps: {change.removedSteps.join(", ")}</p>}</div>)}<ol>{proposal.flowOrder.map(id => <li key={id}>{proposal.flows.find(flow => flow.id === id)?.name ?? flows.find(flow => flow.id === id)?.name ?? id}</li>)}</ol></details>
            {!!session?.trace.length && <details className="flow-ai-changes"><summary>Validation activity</summary><ul>{session.trace.map((item, i) => <li key={i}>{item}</li>)}</ul></details>}
          </>}
        </section>
      </div>
    </DialogContent></Dialog>
  </>;
}
