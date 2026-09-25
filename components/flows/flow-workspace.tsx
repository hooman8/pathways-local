"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Full navigation preserves native beforeunload protection for unsaved flow drafts. */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpRight, ChevronsUp, Braces, Check, Download, FolderOpen, GitBranch, Plus, RefreshCw, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { type ApplicationFlow, type FlowSnapshot, type FlowSummary, type FlowProject } from "@/lib/application-flow";
import FlowCanvas from "./flow-canvas";

const requestHeaders = { "Content-Type": "application/json", "X-Pathways-Client": "1" };
function download(flow: ApplicationFlow) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(flow, null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = `${flow.id}.json`; a.click(); URL.revokeObjectURL(url);
}
function emptyFlow(projectId: string): ApplicationFlow {
  return { version: 1, projectId: projectId || null, id: crypto.randomUUID(), name: "New application flow", description: "", notes: [],
    nodes: [
      { id: "start", kind: "start", title: "Request received", actor: "", phase: "", description: "", checks: [] },
      { id: "process", kind: "process", title: "Process request", actor: "", phase: "", description: "", checks: [] },
      { id: "end", kind: "end", title: "Completed", actor: "", phase: "", description: "", checks: [] },
    ], edges: [{ id: "start-process", source: "start", target: "process", kind: "next", label: "" }, { id: "process-end", source: "process", target: "end", kind: "next", label: "" }],
  };
}
async function readJson(path: string, init?: RequestInit) {
  const response = await fetch(path, { cache: "no-store", signal: AbortSignal.timeout(15000), ...init });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not complete this request.");
  return body;
}
function flowUrl(projectId: string, id?: string) {
  const params = new URLSearchParams({ project: projectId });
  if (id) params.set("flow", id);
  return `/flows?${params}`;
}
export default function FlowWorkspace({ initialId, initialProjectId }: { initialId?: string; initialProjectId?: string }) {
  const [flows, setFlows] = useState<FlowSummary[]>([]), [snapshot, setSnapshot] = useState<FlowSnapshot | null>(null);
  const [projects, setProjects] = useState<FlowProject[]>([]), [projectId, setProjectId] = useState("");
  const [projectRevision, setProjectRevision] = useState(0), [projectDialog, setProjectDialog] = useState<"create" | "move" | null>(null);
  const [projectName, setProjectName] = useState(""), [moveTarget, setMoveTarget] = useState(""), [projectError, setProjectError] = useState("");
  const [arranging, setArranging] = useState(false), [orderStatus, setOrderStatus] = useState("");
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null), [phase, setPhase] = useState(""), [view, setView] = useState<"diagram" | "steps">("diagram");
  const [editor, setEditor] = useState(false), [source, setSource] = useState(""), [creating, setCreating] = useState(false), [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<ApplicationFlow | null>(null), [editorError, setEditorError] = useState(""), [warnings, setWarnings] = useState<string[]>([]);
  const upload = useRef<HTMLInputElement>(null), loadSequence = useRef(0);
  const flow = draft ?? snapshot?.flow;
  const currentProject = projects.find(project => project.id === projectId);
  const visibleFlows = flows.filter(item => (item.projectId ?? "") === projectId);
  const locked = loading || busy || !!draft || editor;
  const flowName = (item: FlowSummary) => currentProject && item.name.startsWith(`${currentProject.name} · `) ? item.name.slice(currentProject.name.length + 3) : item.name;
  const step = flow?.nodes.find(node => node.id === selected);
  const load = useCallback(async (id: string) => {
    const sequence = ++loadSequence.current;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/flows/${encodeURIComponent(id)}`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      if (sequence !== loadSequence.current) return;
      setSnapshot(body); setDraft(null); setCreating(false); setSelected(null); setPhase(""); setWarnings([]);
      setProjectId(body.flow.projectId ?? "");
      window.history.replaceState(null, "", flowUrl(body.flow.projectId ?? "", id));
    } catch (error) { if (sequence === loadSequence.current) setError(error instanceof Error ? error.message : "Could not load this flow."); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }, []);
  const refresh = useCallback(async () => {
    const [catalog, list] = await Promise.all([readJson("/api/projects"), readJson("/api/flows")]);
    setProjects(catalog.projects); setProjectRevision(catalog.revision); setFlows(list.flows);
    return { projects: catalog.projects as FlowProject[], flows: list.flows as FlowSummary[] };
  }, []);
  useEffect(() => {
    let current = true; const sequence = loadSequence;
    Promise.all([readJson("/api/projects"), readJson("/api/flows")]).then(([catalog, list]) => {
      if (!current) return;
      setProjects(catalog.projects); setProjectRevision(catalog.revision); setFlows(list.flows);
      if (initialId) { void load(initialId); return; }
      const target = initialProjectId ?? (list.flows.length ? list.flows[0].projectId ?? "" : catalog.projects[0]?.id ?? "");
      if (target && !catalog.projects.some((project: FlowProject) => project.id === target)) {
        setError("This project does not exist. Choose a project from the list."); setLoading(false); return;
      }
      setProjectId(target);
      const first = list.flows.find((item: FlowSummary) => (item.projectId ?? "") === target);
      if (first) void load(first.id); else setLoading(false);
    }).catch(error => { if (current) { setError(error.message); setLoading(false); } });
    return () => { current = false; sequence.current++; };
  }, [load, initialId, initialProjectId]);
  function selectProject(id: string) {
    loadSequence.current++; setOrderStatus(""); setProjectId(id); setSnapshot(null); setSelected(null); setPhase(""); setError(""); setWarnings([]);
    window.history.replaceState(null, "", flowUrl(id));
    const first = flows.find(item => (item.projectId ?? "") === id);
    if (first) void load(first.id); else setLoading(false);
  }
  async function moveFlow(id: string, target: number) {
    if (locked || target < 0 || target >= visibleFlows.length) return;
    const expectedOrder = visibleFlows.map(item => item.id), flowIds = [...expectedOrder];
    const from = flowIds.indexOf(id);
    if (from < 0 || from === target) return;
    flowIds.splice(from, 1); flowIds.splice(target, 0, id);
    setBusy(true); setError(""); setOrderStatus("");
    try {
      const body = await readJson("/api/flow-order", { method: "PUT", headers: requestHeaders,
        body: JSON.stringify({ projectId: projectId || null, expectedOrder, flowIds }) });
      setFlows(current => [...current.filter(item => (item.projectId ?? "") !== projectId), ...body.flows]);
      setOrderStatus(`${flowName(visibleFlows[from])} moved to position ${target + 1} of ${visibleFlows.length}.`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save the order.");
      await refresh().catch(() => {});
    } finally { setBusy(false); }
  }
  async function saveProject() {
    setBusy(true); setProjectError("");
    try {
      if (projectDialog === "create") {
        const body = await readJson("/api/projects", { method: "POST", headers: requestHeaders, body: JSON.stringify({ name: projectName, revision: projectRevision }) });
        setProjects(current => [...current, body.project]); setProjectRevision(body.revision);
        selectProject(body.project.id);
      } else if (snapshot) {
        const body = await readJson(`/api/flows/${encodeURIComponent(snapshot.flow.id)}`, { method: "PUT", headers: requestHeaders,
          body: JSON.stringify({ flow: { ...snapshot.flow, projectId: moveTarget || null }, revision: snapshot.revision }) });
        setSnapshot(body); setProjectId(moveTarget); window.history.replaceState(null, "", flowUrl(moveTarget, body.flow.id));
      }
      setProjectDialog(null); await refresh().catch(error => setError(error.message));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save the project.";
      if (projectDialog) setProjectError(message); else setError(message);
      try { await refresh(); } catch { /* Keep the actionable save error. */ }
    } finally { setBusy(false); }
  }
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
      setProjectId(body.flow.projectId ?? "");
      window.history.replaceState(null, "", flowUrl(body.flow.projectId ?? "", body.flow.id));
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save. Your draft is kept."); }
    finally { setBusy(false); }
  }
  async function importFile(file?: File) {
    if (!file) return;
    if (file.size > 2_000_000) { setError("Choose a flow JSON file smaller than 2 MB."); return; }
    try { setSource(JSON.stringify({ ...JSON.parse(await file.text()), projectId: projectId || null }, null, 2)); setCreating(true); setEditorError(""); setEditor(true); }
    catch { setError("Could not read this file. Choose a readable JSON file."); }
  }
  return <div className="flow-workspace">
    <aside className="flow-library">
      <a className="flow-brand" href="/"><GitBranch size={22} />pathways<span>.</span></a>
      <a className="flow-back" href="/"><ArrowLeft size={14} />Project roadmaps</a>
      <div className="flow-project-picker"><label htmlFor="flow-project">PROJECT</label><select id="flow-project" value={projectId} disabled={locked} onChange={event => selectProject(event.target.value)}>
        {projects.map(project => <option key={project.id} value={project.id}>{project.name} ({project.flowCount})</option>)}
        <option value="">Unassigned ({flows.filter(item => !item.projectId).length})</option>
      </select><Button variant="ghost" disabled={locked} onClick={() => { setProjectName(""); setProjectError(""); setProjectDialog("create"); }}><Plus size={14} />New project</Button></div>
      <div className="flow-library-heading"><span>APPLICATION FLOWS</span><Button aria-label="Refresh flow list" variant="ghost" size="icon" disabled={locked} onClick={() => { setBusy(true); void refresh().catch(error => setError(error.message)).finally(() => setBusy(false)); }}><RefreshCw size={14} /></Button></div>
      {visibleFlows.length > 1 && <Button className="flow-arrange-toggle" variant="ghost" aria-pressed={arranging} disabled={locked} onClick={() => { setArranging(value => !value); setOrderStatus(""); }}>{arranging ? "Done arranging" : "Arrange flows"}</Button>}
      {arranging && visibleFlows.length > 1 && <p className="flow-order-hint">Move flows to the top, up, or down. Changes save automatically.</p>}
      <nav aria-label="Saved application flows">{visibleFlows.map((item, index) => <div className="flow-library-row" key={item.id}>
        <button disabled={locked} className={`flow-library-item${snapshot?.flow.id === item.id && !creating ? " active" : ""}`} onClick={() => { setCreating(false); void load(item.id); }}><strong>{flowName(item)}</strong><span>{item.nodes} steps · {item.edges} connections</span></button>
        {arranging && <div className="flow-order-controls"><span>{index + 1}</span>
          <Button size="icon" variant="ghost" title="Move to top" aria-label={`Move ${flowName(item)} to top`} disabled={locked || index === 0} onClick={() => void moveFlow(item.id, 0)}><ChevronsUp size={14} /></Button>
          <Button size="icon" variant="ghost" title="Move up" aria-label={`Move ${flowName(item)} up`} disabled={locked || index === 0} onClick={() => void moveFlow(item.id, index - 1)}><ArrowUp size={14} /></Button>
          <Button size="icon" variant="ghost" title="Move down" aria-label={`Move ${flowName(item)} down`} disabled={locked || index === visibleFlows.length - 1} onClick={() => void moveFlow(item.id, index + 1)}><ArrowDown size={14} /></Button>
        </div>}
      </div>)}</nav>
      <p className="sr-only" role="status" aria-live="polite">{orderStatus}</p>
      {!visibleFlows.length && <p className="flow-project-empty">No flows in this project yet.</p>}
      <Button variant="outline" disabled={locked} onClick={() => openEditor(emptyFlow(projectId), true)}><Plus size={15} />New flow</Button>
      <Button variant="ghost" disabled={locked} onClick={() => upload.current?.click()}><Upload size={15} />Import flow</Button>
      <input ref={upload} type="file" accept="application/json,.json" className="sr-only" aria-label="Import application flow JSON" onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ""; }} />
      <p className="flow-library-note">Design application behavior, approvals, timers, and recovery paths. Definitions are saved on this computer.</p>
    </aside>
    <main className="flow-main">
      <header className="flow-topbar"><span>{currentProject?.name ?? "Unassigned"} / Application flows</span><span className="flow-mode-badge">DESIGN VIEW</span></header>
      {error && <div className="flow-error" role="alert">{error}</div>}
      {loading ? <div className="flow-empty" role="status">Loading flows…</div> : !flow ? <div className="flow-empty"><GitBranch size={34} /><h1>{currentProject ? `${currentProject.name} workflows` : "Map how your application works"}</h1><p>Create or import a flow in {currentProject?.name ?? "Unassigned"}.</p><Button onClick={() => openEditor(emptyFlow(projectId), true)}>Create your first flow</Button></div> : <>
        <div className="flow-heading"><div><div className="flow-eyebrow">{currentProject?.name ?? "Unassigned"} · APPLICATION BEHAVIOR</div><h1>{flow.name}</h1><p>{flow.description}</p></div><div className="flow-actions"><Button variant="outline" disabled={locked} onClick={() => { setMoveTarget(projectId); setProjectError(""); setProjectDialog("move"); }}><FolderOpen size={15} />Move to project</Button><Button variant="outline" disabled={busy} onClick={() => openEditor(flow, !!draft && creating)}><Braces size={15} />Edit definition</Button><Button variant="outline" onClick={() => download(flow)}><Download size={15} />Export</Button></div></div>
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
    <Dialog open={projectDialog !== null} onOpenChange={open => { if (!open && !busy) setProjectDialog(null); }}><DialogContent><DialogHeader>
      <DialogTitle>{projectDialog === "create" ? "New project" : "Move flow to project"}</DialogTitle>
      <DialogDescription>{projectDialog === "create" ? "Group related workflows under one project. It also appears in Project roadmaps with an empty roadmap." : "Move this saved flow. Its ID, detail-flow links, and diagram stay the same."}</DialogDescription>
      </DialogHeader><form className="flow-project-form" onSubmit={event => { event.preventDefault(); void saveProject(); }}>
        {projectDialog === "create" ? <label>Project name<input autoFocus required maxLength={100} value={projectName} onChange={event => setProjectName(event.target.value)} placeholder="e.g. Customer onboarding" /></label> : <label>Destination project<select value={moveTarget} onChange={event => setMoveTarget(event.target.value)}>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}<option value="">Unassigned</option></select></label>}
        {projectError && <p className="flow-editor-error" role="alert">{projectError}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setProjectDialog(null)}>Cancel</Button><Button type="submit" disabled={busy || (projectDialog === "create" ? !projectName.trim() : moveTarget === projectId)}>{busy ? "Saving…" : projectDialog === "create" ? "Create project" : "Move flow"}</Button></DialogFooter>
      </form></DialogContent></Dialog>
    <Dialog open={editor} onOpenChange={open => { if (!open) closeEditor(); }}><DialogContent className="flow-json-dialog"><DialogHeader><DialogTitle>{creating ? "Create application flow" : "Edit flow definition"}</DialogTitle><DialogDescription>Define steps and labeled connections in JSON. Validation checks references, decisions, timers, and bounded retries before preview.</DialogDescription></DialogHeader><Textarea aria-label="Flow definition JSON" spellCheck={false} value={source} onChange={event => setSource(event.target.value)} />{editorError && <pre className="flow-editor-error" role="alert">{editorError}</pre>}<DialogFooter><Button variant="outline" disabled={busy} onClick={closeEditor}>Cancel</Button><Button disabled={busy} onClick={() => void preview()}>{busy ? "Validating…" : "Validate & preview"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
