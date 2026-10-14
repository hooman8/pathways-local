import { validateFlow } from "../lib/application-flow";

export function architectureFixture() {
  return validateFlow({ version: 1, id: "architecture-example", name: "Laptop and display station", diagramType: "architecture",
    groups: [{ id: "laptop", title: "Laptop", description: "Author tasks and documents" }, { id: "display", title: "Display station", description: "Calendar and reminders" }],
    nodes: [
      { id: "editor", kind: "human", title: "Note editor", actor: "Create tasks and attach files", groupId: "laptop" },
      { id: "laptop-files", kind: "database", title: "Task folder", actor: "Notes and attachments", groupId: "laptop" },
      { id: "laptop-sync", kind: "process", title: "Sync client", actor: "Laptop service", groupId: "laptop" },
      { id: "desktop", kind: "process", title: "Desktop session", actor: "Launch and keep awake", groupId: "display" },
      { id: "browser", kind: "human", title: "Kiosk browser", actor: "Next task and reminders", groupId: "display" },
      { id: "private-state", kind: "database", title: "Reminder state", actor: "Snooze and dismiss", groupId: "display" },
      { id: "server", kind: "api", title: "Calendar server", actor: "Local HTTP service", groupId: "display" },
      { id: "display-sync", kind: "process", title: "Sync client", actor: "Display station service", groupId: "display" },
      { id: "display-files", kind: "database", title: "Task folder", actor: "Notes and attachments", groupId: "display" },
    ],
    edges: [
      { id: "edit", source: "editor", target: "laptop-files", direction: "both" },
      { id: "watch-laptop", source: "laptop-files", target: "laptop-sync", direction: "both" },
      { id: "sync", source: "laptop-sync", target: "display-sync", direction: "both", label: "Two-way file sync" },
      { id: "watch-display", source: "display-sync", target: "display-files", direction: "both", label: "Files" },
      { id: "read-tasks", source: "server", target: "display-files", direction: "both", label: "Task files" },
      { id: "http", source: "browser", target: "server", direction: "both", label: "Local HTTP" },
      { id: "state", source: "server", target: "private-state", direction: "both", label: "SQLite" },
      { id: "launch", source: "desktop", target: "browser", label: "Launch" },
    ], presentationNotes: "The laptop authors task notes and attached documents. Two sync clients keep the paired folders aligned in both directions. The display station runs its local server and browser; reminder acknowledgements stay in its private state.",
  });
}
