"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { Project } from "@/lib/projects";
import { isGroup } from "@/lib/roadmap";

export default function SaveTemplateDialog({ project, onSave, onClose }: {
  project: Project; onSave: (name: string, description: string) => void; onClose: () => void;
}) {
  const [name, setName] = useState(`${project.roadmap.application} template`.slice(0, 100));
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const count = project.roadmap.tasks.filter(t => !isGroup(t.id, project.roadmap.tasks)).length;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="project-dialog sm:max-w-[580px]">
    <DialogHeader><div className="eyebrow">NEW TEMPLATE</div><DialogTitle>Save this project as a template</DialogTitle><DialogDescription>Reuse the workflow from {project.roadmap.application} when creating other projects.</DialogDescription></DialogHeader>
    <form className="project-form" onSubmit={event => {
      event.preventDefault();
      try { onSave(name, description); onClose(); }
      catch (e) { setError(e instanceof Error ? e.message : "Could not save this template."); }
    }}>
      <div className="project-fields">
        <div><Label htmlFor="template-name">Template name</Label><Input id="template-name" value={name} onChange={e => setName(e.target.value)} required maxLength={100} autoFocus placeholder="e.g. Application with database" /></div>
        <div><Label htmlFor="template-description">Description <span className="field-hint">optional</span></Label><Textarea id="template-description" value={description} onChange={e => setDescription(e.target.value)} maxLength={500} rows={3} placeholder="When should someone use this template?" /></div>
        <div className="template-summary"><strong>{count} task{count === 1 ? "" : "s"} with fresh progress</strong><p>Includes substeps, decisions, dependencies, instructions, and responsible teams. Progress, decision answers, impediments, and engineer assignments start fresh.</p><p>This is a separate copy. Later project edits won’t change it. Available to workspace members with access to all projects.</p></div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit"><Copy size={16} />Save template</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
