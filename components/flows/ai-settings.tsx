"use client";
import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Settings = { configured: boolean; enabled: boolean; source: "environment" | "local" | "none"; model: string; canRemove: boolean };
export default function AiSettings({ disabled = false, onChanged }: { disabled?: boolean; onChanged?: () => void }) {
  const [open, setOpen] = useState(false), [settings, setSettings] = useState<Settings | null>(null);
  const [key, setKey] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  async function load() {
    setOpen(true); setBusy(true); setError(""); setKey(""); setStatus("");
    try { const response = await fetch("/api/ai/settings", { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setSettings(data); }
    catch { setError("Could not load AI settings. Try again."); }
    finally { setBusy(false); }
  }
  async function change(remove = false) {
    setBusy(true); setError(""); setStatus("");
    try {
      const response = await fetch("/api/ai/settings", { method: remove ? "DELETE" : "PUT", headers: { "Content-Type": "application/json", "X-Pathways-Client": "1" }, ...(remove ? {} : { body: JSON.stringify({ apiKey: key.trim() }) }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setSettings(data); setKey(""); setStatus(remove ? "The locally saved key was removed." : "Your key is saved. Astra is ready when you send a request."); onChanged?.();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save AI settings."); }
    finally { setBusy(false); }
  }
  return <>
    <Button variant="ghost" disabled={disabled} onClick={() => void load()}><KeyRound size={15} />AI settings</Button>
    <Dialog open={open} onOpenChange={value => { setOpen(value); if (!value) setKey(""); }}><DialogContent className="flow-ai-settings"><DialogHeader>
      <DialogTitle>Astra with your API key</DialogTitle><DialogDescription>Optional AI authoring for workflows and architecture. Pathways Local needs no subscription. OpenAI bills usage to the account that owns your key.</DialogDescription>
    </DialogHeader>
      {settings && <p>{settings.configured ? `Astra is connected using ${settings.source === "environment" ? "the server environment" : "a key saved on this computer"}.` : "Connect an OpenAI API key to use Astra."} Model: {settings.model}.{!settings.enabled && settings.configured ? " Generation is disabled by the server environment." : ""}</p>}
      {settings?.source === "environment" && <p>OPENAI_API_KEY in the server environment takes precedence. Change it in your local configuration to replace that key.</p>}
      <form onSubmit={event => { event.preventDefault(); void change(); }} className="flow-ai-settings-form">
        <label htmlFor="astra-key">OpenAI API key</label>
        <input id="astra-key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={event => setKey(event.target.value)} maxLength={4096} placeholder="Enter your API key" disabled={busy || settings?.source === "environment"} />
        <p>The key stays in a protected local server file. It is never returned to the browser or included in project exports. Sending to Astra shares the diagrams in this project and your request with OpenAI.</p>
        <div className="flow-ai-settings-actions"><Button type="submit" disabled={busy || key.trim().length < 20 || settings?.source === "environment"}>{busy ? "Saving…" : "Save key"}</Button><Button type="button" variant="outline" disabled={busy || !settings?.canRemove} onClick={() => void change(true)}>Remove saved key</Button></div>
      </form>
      {error && <p role="alert" className="flow-ai-error">{error}</p>}{status && <p role="status">{status}</p>}
      <p>Local agents can create and refine diagrams through the local agent API without giving Pathways an API key.</p>
    </DialogContent></Dialog>
  </>;
}
