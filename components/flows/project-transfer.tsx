"use client";
import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { validateBundle, bundleWarnings, MAX_BUNDLE_BYTES, type ProjectBundle, type BundleImportResult } from "@/lib/project-bundle";

export default function ProjectTransfer({ projectId, disabled, canImport, onImported, onError }: {
  projectId: string; disabled: boolean; canImport: boolean;
  onImported: (result: BundleImportResult) => Promise<void>; onError: (message: string) => void;
}) {
  const upload = useRef<HTMLInputElement>(null);
  const [review, setReview] = useState<{ bundle: ProjectBundle; revision: number; importId: string } | null>(null);
  const [name, setName] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function exportProject() {
    setBusy(true);
    try {
      const response = await fetch(`/api/project-bundles?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store", signal: AbortSignal.timeout(30000) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      const bundle = validateBundle(body);
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `${bundle.project.roadmap.application.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pathways.json`; link.click(); URL.revokeObjectURL(url);
    } catch (error) { onError(error instanceof Error ? error.message : "Could not export this project."); }
    finally { setBusy(false); }
  }
  async function choose(file?: File) {
    if (!file) return;
    setBusy(true); setError("");
    try {
      if (file.size > MAX_BUNDLE_BYTES) throw new Error("Choose a complete project file smaller than 5 MB.");
      const bundle = validateBundle(JSON.parse(await file.text()));
      const response = await fetch("/api/projects", { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const catalog = await response.json(); if (!response.ok) throw new Error(catalog.error);
      setName(bundle.project.roadmap.application); setReview({ bundle, revision: catalog.revision, importId: crypto.randomUUID() });
    } catch (error) { onError(error instanceof Error ? error.message : "Could not read this project file."); }
    finally { setBusy(false); }
  }
  async function importProject() {
    if (!review) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/project-bundles", { method: "POST", headers: { "Content-Type": "application/json", "X-Pathways-Client": "1" },
        body: JSON.stringify({ ...review, name }), signal: AbortSignal.timeout(60000) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setReview(null); await onImported(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not import. Your file is kept for retry.");
      try { const response = await fetch("/api/projects", { cache: "no-store" }); if (response.ok) { const catalog = await response.json(); setReview(current => current ? { ...current, revision: catalog.revision } : null); } } catch { /* Retry with the same import ID after a lost response. */ }
    } finally { setBusy(false); }
  }
  return <>
    <div className="flow-project-transfer"><Button variant="ghost" disabled={disabled || busy || !projectId} onClick={() => void exportProject()}><Download size={14} />Export complete project</Button><Button variant="ghost" disabled={disabled || busy || !canImport} onClick={() => upload.current?.click()}><Upload size={14} />Import complete project</Button></div>
    <input className="sr-only" ref={upload} type="file" accept="application/json,.json" aria-label="Import complete project file" onChange={event => { void choose(event.target.files?.[0]); event.target.value = ""; }} />
    <Dialog open={!!review} onOpenChange={open => { if (!open && !busy) setReview(null); }}><DialogContent><DialogHeader><DialogTitle>Import complete project</DialogTitle><DialogDescription>Creates a new project with its roadmap, flows, saved order, and internal detail links. Existing projects stay intact. Sign-in accounts and permissions are not imported.</DialogDescription></DialogHeader>
      {review && <form className="flow-project-form" onSubmit={event => { event.preventDefault(); void importProject(); }}><label>Project name<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>
        <p>{review.bundle.project.roadmap.tasks.length} roadmap steps · {review.bundle.flows.length} flows · {review.bundle.engineers.length} engineers</p>
        <ol className="flow-import-order">{review.bundle.flowOrder.map(id => <li key={id}>{review.bundle.flows.find(flow => flow.id === id)!.name}</li>)}</ol>
        {bundleWarnings(review.bundle).map(warning => <p className="flow-editor-error" key={warning}>{warning}</p>)}
        {error && <p className="flow-editor-error" role="alert">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setReview(null)}>Cancel</Button><Button type="submit" disabled={busy || !name.trim()}>{busy ? "Importing…" : "Import as new project"}</Button></DialogFooter>
      </form>}
    </DialogContent></Dialog>
  </>;
}
