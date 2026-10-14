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

export function localAppArchitectureFixture() {
  return validateFlow({ version: 1, id: "local-app", name: "Pathways Local architecture", diagramType: "architecture",
    groups: [{ id: "client", title: "Your computer" }, { id: "app", title: "Docker application" }, { id: "cloud", title: "Optional OpenAI" }],
    nodes: [
      { id: "browser", kind: "frontend", title: "Browser workspace", groupId: "client" },
      { id: "agent", kind: "process", title: "Local agent", groupId: "client" },
      { id: "web", kind: "service", title: "Next.js server", groupId: "app" },
      { id: "api", kind: "api", title: "Local APIs", groupId: "app" },
      { id: "authoring", kind: "service", title: "Authoring runner", groupId: "app" },
      { id: "db", kind: "database", title: "SQLite volume", groupId: "app" },
      { id: "key", kind: "database", title: "Optional API key", groupId: "app" },
      { id: "astra", kind: "external", title: "Astra API", groupId: "cloud" },
    ], edges: [
      { id: "ui", source: "browser", target: "web", label: "Local HTTP", direction: "both" },
      { id: "routes", source: "web", target: "api", label: "Routes" },
      { id: "agent-request", source: "agent", target: "api", label: "Agent API", direction: "both" },
      { id: "storage", source: "api", target: "db", label: "Read / write", direction: "both" },
      { id: "draft", source: "api", target: "authoring", label: "Authoring", direction: "both" },
      { id: "jobs", source: "authoring", target: "db", label: "Drafts & jobs", direction: "both" },
      { id: "secret", source: "key", target: "authoring", label: "Read key" },
      { id: "generation", source: "authoring", target: "astra", label: "Optional generation", direction: "both" },
      { id: "agent-review", source: "agent", target: "browser", label: "Open review link" },
    ],
  });
}
