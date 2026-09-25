"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Full navigation preserves native beforeunload protection for unsaved flow drafts. */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Braces, Check, Download, GitBranch, Plus, RefreshCw, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { type ApplicationFlow, type FlowSnapshot, type FlowSummary } from "@/lib/application-flow";
import FlowCanvas from "./flow-canvas";

const requestHeaders = { "Content-Type": "application/json", "X-Pathways-Client": "1" };
function download(flow: ApplicationFlow) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(flow, null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = `${flow.id}.json`; a.click(); URL.revokeObjectURL(url);
}
function emptyFlow(): ApplicationFlow {
  return { version: 1, id: crypto.randomUUID(), name: "New application flow", description: "", notes: [],
    nodes: [
      { id: "start", kind: "start", title: "Request received", actor: "", phase: "", description: "", checks: [] },
      { id: "process", kind: "process", title: "Process request", actor: "", phase: "", description: "", checks: [] },
      { id: "end", kind: "end", title: "Completed", actor: "", phase: "", description: "", checks: [] },
    ], edges: [{ id: "start-process", source: "start", target: "process", kind: "next", label: "" }, { id: "process-end", source: "process", target: "end", kind: "next", label: "" }],
  };
}
export default function FlowWorkspace({ initialId }: { initialId?: string }) {
  const [flows, setFlows] = useState<FlowSummary[]>([]), [snapshot, setSnapshot] = useState<FlowSnapshot | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null), [phase, setPhase] = useState(""), [view, setView] = useState<"diagram" | "steps">("diagram");
  const [editor, setEditor] = useState(false), [source, setSource] = useState(""), [creating, setCreating] = useState(false), [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<ApplicationFlow | null>(null), [editorError, setEditorError] = useState(""), [warnings, setWarnings] = useState<string[]>([]);
  const upload = useRef<HTMLInputElement>(null), loadSequence = useRef(0);
  const flow = draft ?? snapshot?.flow;
  const step = flow?.nodes.find(node => node.id === selected);
  const load = useCallback(async (id: string) => {
    const sequence = ++loadSequence.current;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/flows/${encodeURIComponent(id)}`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      if (sequence !== loadSequence.current) return;
      setSnapshot(body); setDraft(null); setCreating(false); setSelected(null); setPhase(""); setWarnings([]);
      window.history.replaceState(null, "", `/flows?flow=${encodeURIComponent(id)}`);
    } catch (error) { if (sequence === loadSequence.current) setError(error instanceof Error ? error.message : "Could not load this flow."); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }, []);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/flows", { cache: "no-store", signal: AbortSignal.timeout(10000) });
    const body = await response.json(); if (!response.ok) throw new Error(body.error);
    setFlows(body.flows); return body.flows as FlowSummary[];
  }, []);
  useEffect(() => {
    let current = true; const sequence = loadSequence;
    fetch("/api/flows", { cache: "no-store", signal: AbortSignal.timeout(10000) }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error); return body.flows as FlowSummary[];
    }).then(list => { if (!current) return; setFlows(list); const id = initialId ?? list[0]?.id; if (id) void load(id); else setLoading(false); })
      .catch(error => { if (current) { setError(error.message); setLoading(false); } });
    return () => { current = false; sequence.current++; };
  }, [load, initialId]);
  useEffect(() => {
    const leaving = (event: BeforeUnloadEvent) => { if (draft || editor) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", leaving); return () => window.removeEventListener("beforeunload", leaving);
  }, [draft, editor]);
  const openEditor = (value: ApplicationFlow, isNew: boolean) => { setSource(JSON.stringify(value, null, 2)); setCreating(isNew); setEditorError(""); setEditor(true); };
  const closeEditor = () => { if (!busy) { setEditor(false); if (!draft) setCreating(false); } };
  async function validateSource() {
    let value; try { value = JSON.parse(source); } catch { throw new Error("Enter valid JSON before previewing."); }
    const response = await fetch("/api/flows/validate", { method: "POST", headers: requestHeaders, body: JSON.stringify({ flow: value }), signal: AbortSignal.timeout(15000) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.issues?.map((issue: { path: string; message: string }) => `${issue.path}: ${issue.message}`).join("\n") || body.error);
    setWarnings(body.warnings); return body.flow as ApplicationFlow;
  }
  async function preview() {
    setBusy(true); setEditorError("");
    try { setDraft(await validateSource()); setEditor(false); setSelected(null); setPhase(""); }
    catch (error) { setEditorError(error instanceof Error ? error.message : "Could not validate the flow."); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!draft) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(creating ? "/api/flows" : `/api/flows/${encodeURIComponent(snapshot!.flow.id)}`, {
        method: creating ? "POST" : "PUT", headers: requestHeaders,
        body: JSON.stringify({ flow: draft, ...(!creating ? { revision: snapshot!.revision } : {}) }), signal: AbortSignal.timeout(15000),
      });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      setSnapshot(body); setDraft(null); setCreating(false); await refresh();
      window.history.replaceState(null, "", `/flows?flow=${encodeURIComponent(body.flow.id)}`);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save. Your draft is kept."); }
    finally { setBusy(false); }
  }
  async function importFile(file?: File) {
    if (!file) return;
    if (file.size > 2_000_000) { setError("Choose a flow JSON file smaller than 2 MB."); return; }
    try { setSource(await file.text()); setCreating(true); setEditorError(""); setEditor(true); }
    catch { setError("Could not read this file. Choose a readable JSON file."); }
  }
  return <div className="flow-workspace">
    <aside className="flow-library">
      <a className="flow-brand" href="/"><GitBranch size={22} />pathways<span>.</span></a>
      <a className="flow-back" href="/"><ArrowLeft size={14} />Project roadmaps</a>
      <div className="flow-library-heading"><span>APPLICATION FLOWS</span><Button aria-label="Refresh flow list" variant="ghost" size="icon" disabled={busy || !!draft} onClick={() => void refresh().catch(error => setError(error.message))}><RefreshCw size={14} /></Button></div>
      <nav aria-label="Saved application flows">{flows.map(item => <button key={item.id} disabled={!!draft || busy} className={`flow-library-item${snapshot?.flow.id === item.id && !creating ? " active" : ""}`} onClick={() => { setCreating(false); void load(item.id); }}><strong>{item.name}</strong><span>{item.nodes} steps · {item.edges} connections</span></button>)}</nav>
      <Button variant="outline" disabled={!!draft || busy} onClick={() => openEditor(emptyFlow(), true)}><Plus size={15} />New flow</Button>
      <Button variant="ghost" disabled={!!draft || busy} onClick={() => upload.current?.click()}><Upload size={15} />Import flow</Button>
      <input ref={upload} type="file" accept="application/json,.json" className="sr-only" aria-label="Import application flow JSON" onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ""; }} />
      <p className="flow-library-note">Design application behavior, approvals, timers, and recovery paths. Definitions are saved on this computer.</p>
    </aside>
    <main className="flow-main">
      <header className="flow-topbar"><span>Application flows</span><span className="flow-mode-badge">DESIGN VIEW</span></header>
      {error && <div className="flow-error" role="alert">{error}</div>}
      {loading ? <div className="flow-empty" role="status">Loading flows…</div> : !flow ? <div className="flow-empty"><GitBranch size={34} /><h1>Map how your application works</h1><p>Create a flow or import a definition generated through the API.</p><Button onClick={() => openEditor(emptyFlow(), true)}>Create your first flow</Button></div> : <>
        <div className="flow-heading"><div><div className="flow-eyebrow">APPLICATION BEHAVIOR</div><h1>{flow.name}</h1><p>{flow.description}</p></div><div className="flow-actions"><Button variant="outline" disabled={busy} onClick={() => openEditor(flow, !!draft && creating)}><Braces size={15} />Edit definition</Button><Button variant="outline" onClick={() => download(flow)}><Download size={15} />Export</Button></div></div>
        {draft && <div className="flow-draft" role="status"><span><strong>Draft preview</strong> · Review before saving.</span><div><Button variant="ghost" disabled={busy} onClick={() => { setDraft(null); setCreating(false); setError(""); setWarnings([]); }}>Discard draft</Button><Button disabled={busy} onClick={() => void save()}><Check size={15} />{busy ? "Saving…" : "Save flow"}</Button></div></div>}
        {!!warnings.length && <div className="flow-warning">{warnings.join(" ")}</div>}
        <div className="flow-toolbar"><div className="flow-view-tabs"><button aria-pressed={view === "diagram"} onClick={() => setView("diagram")}>Diagram</button><button aria-pressed={view === "steps"} onClick={() => setView("steps")}>Steps</button></div><label>Phase <select value={phase} onChange={event => { setPhase(event.target.value); setSelected(null); }}><option value="">All phases</option>{[...new Set(flow.nodes.map(node => node.phase).filter(Boolean))].map(phase => <option key={phase}>{phase}</option>)}</select></label><span>{flow.nodes.length} steps · {flow.edges.length} connections{snapshot && !creating ? ` · Revision ${snapshot.revision}` : ""}</span></div>
        <div className={`flow-content${step ? " with-details" : ""}`}>
          {view === "diagram" ? <FlowCanvas flow={flow} phase={phase} selected={selected} onSelect={setSelected} /> : <div className="flow-step-list">{flow.nodes.filter(node => !phase || node.phase === phase).map(node => <button key={node.id} className={selected === node.id ? "active" : ""} onClick={() => setSelected(node.id)}><span className={`flow-kind-label flow-kind-${node.kind}`}>{node.kind}</span><div><strong>{node.title}</strong><p>{node.actor}{node.phase ? ` · ${node.phase}` : ""}</p></div><ArrowUpRight size={16} /></button>)}</div>}
          {step && <aside className="flow-details"><div className="flow-detail-top"><span>{step.kind}</span><Button aria-label="Close step details" variant="ghost" size="icon" onClick={() => setSelected(null)}><X size={16} /></Button></div><h2>{step.title}</h2>{step.actor && <p className="flow-detail-actor">{step.actor}</p>}<p className="flow-detail-description">{step.description || "No additional details."}</p>{step.timer && <section><h3>Timer rule</h3><p>{step.timer.mode}: {step.timer.expression}</p><small>This describes the timer; the diagram does not schedule a live action.</small></section>}{!!step.checks.length && <section><h3>Checks & outcomes</h3><ul>{step.checks.map((check, i) => <li key={i}>{check}</li>)}</ul></section>}{step.subflowId && <Button variant="outline" disabled={!!draft} onClick={() => void load(step.subflowId!)}>Open detail flow <ArrowUpRight size={15} /></Button>}<section><h3>Next steps</h3>{flow.edges.filter(edge => edge.source === step.id).map(edge => <div key={edge.id} className="flow-next-step"><button onClick={() => { setPhase(""); setSelected(edge.target); }}><span>{edge.label || "Next"}</span>{flow.nodes.find(node => node.id === edge.target)?.title}</button>{edge.retry && <small>Up to {edge.retry.maxAttempts} attempts · {edge.retry.backoff}</small>}</div>)}</section></aside>}
        </div>
        {!!flow.notes.length && <details className="flow-notes"><summary>Design notes & assumptions ({flow.notes.length})</summary><ul>{flow.notes.map((note, i) => <li key={i}>{note}</li>)}</ul></details>}
        <footer className="flow-footer">A model of the process. Steps and timers here do not call external systems.</footer>
      </>}
    </main>
    <Dialog open={editor} onOpenChange={open => { if (!open) closeEditor(); }}><DialogContent className="flow-json-dialog"><DialogHeader><DialogTitle>{creating ? "Create application flow" : "Edit flow definition"}</DialogTitle><DialogDescription>Define steps and labeled connections in JSON. Validation checks references, decisions, timers, and bounded retries before preview.</DialogDescription></DialogHeader><Textarea aria-label="Flow definition JSON" spellCheck={false} value={source} onChange={event => setSource(event.target.value)} />{editorError && <pre className="flow-editor-error" role="alert">{editorError}</pre>}<DialogFooter><Button variant="outline" disabled={busy} onClick={closeEditor}>Cancel</Button><Button disabled={busy} onClick={() => void preview()}>{busy ? "Validating…" : "Validate & preview"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
