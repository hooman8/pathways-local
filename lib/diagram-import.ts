import { diagramTypeOf, type ApplicationFlow, type FlowSnapshot } from "./application-flow";

type ImportDestination =
  | { mode: "new"; projectId: string | null }
  | { mode: "copy"; projectId: string | null; id: string }
  | { mode: "replace"; existing: FlowSnapshot };

export function prepareDiagramImport(imported: ApplicationFlow, destination: ImportDestination): ApplicationFlow {
  if (destination.mode === "replace") {
    const saved = destination.existing.flow;
    if (imported.id !== saved.id) throw new Error("Keep the existing diagram ID when replacing it, or import as a copy.");
    if (diagramTypeOf(imported) !== diagramTypeOf(saved)) throw new Error("A replacement must have the same diagram type. Import as a copy instead.");
    return { ...imported, projectId: saved.projectId };
  }
  return { ...imported, projectId: destination.projectId, ...(destination.mode === "copy" ? { id: destination.id } : {}) };
}
