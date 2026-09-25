"use client";
import { useEffect, useState } from "react";
import { BookOpen, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { MAX_PRESENTATION_NOTES_LENGTH } from "@/lib/application-flow";

export default function PresentationNotes({ name, notes, canEdit, disabled, onClose, onEditing, onSave, size, onSize }: {
  name: string; notes: string; canEdit: boolean; disabled: boolean; size: string; onSize: (size: string) => void;
  onClose: () => void; onEditing: (editing: boolean) => void; onSave: (notes: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false), [source, setSource] = useState(notes);
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const dirty = editing && source !== notes;
  useEffect(() => {
    if (!dirty) return;
    const leaving = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", leaving);
    return () => window.removeEventListener("beforeunload", leaving);
  }, [dirty]);
  function edit() { setSource(notes); setError(""); setSaved(false); setEditing(true); onEditing(true); }
  function closeEditor() {
    if (saving || (dirty && !window.confirm("Discard your unsaved presenter notes?"))) return;
    setEditing(false); onEditing(false);
  }
  async function save() {
    setSaving(true); setError("");
    try { await onSave(source); setEditing(false); onEditing(false); setSaved(true); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not save your write-up. Your draft is kept here."); }
    finally { setSaving(false); }
  }
  function downloadDraft() {
    const url = URL.createObjectURL(new Blob([source], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "presenter-notes.txt"; link.click(); URL.revokeObjectURL(url);
  }
  return <aside className="flow-presentation" aria-label="Presenter notes">
    <div className="flow-presentation-header"><h2><BookOpen size={17} />Presenter notes</h2><Button aria-label="Hide presenter notes" variant="ghost" size="icon" onClick={onClose}><X size={16} /></Button></div>
    <p className="flow-presentation-name">{name}</p>
    <div className="flow-presentation-controls"><label>Text size<select aria-label="Presenter text size" value={size} onChange={event => onSize(event.target.value)}><option value="16">Small</option><option value="18">Medium</option><option value="22">Large</option></select></label>{canEdit && <Button variant="outline" size="sm" disabled={disabled} onClick={edit}><Pencil size={13} />{notes ? "Edit write-up" : "Add write-up"}</Button>}</div>
    <div className="flow-presentation-reader" tabIndex={0} role="region" aria-label={`${name} presentation write-up`} style={{ fontSize: `${size}px` }}>
      {notes ? <div className="flow-presentation-text">{notes}</div> : <div className="flow-presentation-empty"><p>No write-up yet.</p><p>{canEdit ? "Add your opening, talking points, and walkthrough. Read here while you explore the flow." : "This flow has no presenter notes yet."}</p></div>}
    </div>
    <p className="flow-presentation-status" role="status">{saved ? "Write-up saved." : "Saved with this flow · Included in exports"}</p>
    <Dialog open={editing} onOpenChange={open => { if (!open) closeEditor(); }}><DialogContent className="flow-presentation-dialog" showCloseButton={!saving} onInteractOutside={event => event.preventDefault()}><DialogHeader><DialogTitle>Edit presenter notes</DialogTitle><DialogDescription>{name}. Write in your own words; paragraphs and line breaks are preserved. These notes are shared with people who can view this flow.</DialogDescription></DialogHeader>
      <Textarea aria-label="Presentation write-up" value={source} maxLength={MAX_PRESENTATION_NOTES_LENGTH} disabled={saving} onChange={event => setSource(event.target.value)} placeholder="Start with the purpose of this flow, then walk through its main path and exceptions…" />
      <span className="flow-presentation-count">{source.length.toLocaleString()} / {MAX_PRESENTATION_NOTES_LENGTH.toLocaleString()} characters</span>
      {error && <div className="flow-editor-error" role="alert"><p>{error}</p><p>Keep a copy of your draft before closing and reloading the flow.</p><Button variant="outline" onClick={downloadDraft}>Download draft</Button></div>}
      <DialogFooter><Button variant="outline" disabled={saving} onClick={closeEditor}>Cancel</Button><Button disabled={saving || !dirty} onClick={() => void save()}>{saving ? "Saving…" : "Save write-up"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </aside>;
}
