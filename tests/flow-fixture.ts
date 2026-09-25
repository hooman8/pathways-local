import { validateFlow } from "../lib/application-flow";

export function exampleFlow() {
  return validateFlow({ version: 1, id: "example-request", name: "Example request",
    nodes: [
      { id: "start", kind: "start", title: "Received" },
      { id: "decision", kind: "decision", title: "Approved?" },
      { id: "wait", kind: "timer", title: "Wait until approved start", timer: { mode: "deadline", expression: "request.startsAt" } },
      { id: "work", kind: "process", title: "Apply change" },
      { id: "retry", kind: "decision", title: "Retry available?" },
      { id: "end", kind: "end", title: "Finished" },
    ], edges: [
      { id: "a", source: "start", target: "decision" },
      { id: "b", source: "decision", target: "wait", label: "Yes", kind: "branch" },
      { id: "c", source: "decision", target: "end", label: "No", kind: "branch" },
      { id: "d", source: "wait", target: "work" },
      { id: "e", source: "work", target: "end", label: "Succeeded" },
      { id: "f", source: "work", target: "retry", label: "Failed", kind: "error" },
      { id: "g", source: "retry", target: "work", label: "Yes", kind: "retry", retry: { maxAttempts: 3, backoff: "Exponential delay" } },
      { id: "h", source: "retry", target: "end", label: "Exhausted", kind: "branch" },
    ],
  });
}
