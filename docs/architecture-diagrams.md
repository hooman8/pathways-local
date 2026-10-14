# Architecture view

[Documentation home](../README.md)

Choose **Architecture** from a project's roadmap sidebar or its diagram navigation.
Application flows and Architecture have separate libraries in the same project.
Switching views keeps the selected project. Existing architecture bookmarks opened
through `/flows?flow=<id>` move to the Architecture view.

Create with **New architecture** or **Import architecture**, then edit the JSON,
**Validate & preview**, and **Save architecture**. Use **Components** to inspect
responsibilities, technologies, and checks. Connections show incoming, outgoing,
and two-way relationships; **Group** focuses a system boundary and its connected
components. **Expand diagram** gives a larger canvas. Pan, zoom, or Fit View to
inspect a large map. Presenter notes are saved with the diagram.

For generation or refinement, use **Build with AI** after saving your own OpenAI
API key, or **Use a local agent** with no Pathways key. Ask for the frontend,
services, APIs, data, queues, integrations, deployment boundaries, and labeled
connections. Review component details, assumptions, and presenter notes before
Apply. See [AI and agent authoring](ai-authoring.md).

Architecture uses the shared version-1 definition with
`diagramType:"architecture"`. Provide 1–12 nonempty groups, assign every node a
`groupId`, and connect every component. Component kinds include `frontend`,
`service`, `api`, `database`, `queue`, `cache`, `external`, `infrastructure`,
`human`, and `subflow`; legacy node kinds remain accepted. Architecture can have
connected cycles without workflow start/end nodes. Connections use `kind:"next"`
and optional `direction:"forward"` or `"both"`. Two-way relationships render
arrowheads at both ends. The diagram does not run code or schedule operations.

Keep group descriptions and labels concise for readability; put detailed
explanations in component descriptions and notes. Rearranging diagrams moves only
this view's slots in the shared project order; the other view retains its order.

Single-diagram and complete-project exports preserve groups, component kinds,
directions, and notes. Pathways Local 1.1.0 is compatible with the hosted Architecture
release. Older Local releases reject architecture fields and need an update before
importing these files. Workflows retain their prior validation and file behavior.
