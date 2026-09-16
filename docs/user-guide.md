# User guide

[Documentation home](../README.md)

## Open your local workspace

1. Start Docker Desktop and run `docker compose up -d --build`.
2. Open `http://localhost:8080`. Your workspace opens with automatic owner access.
3. Use **Teams & engineers** to create planning teams and engineer labels.
4. Create a project, then select its responsible teams and engineers in each task.
5. Expand workstreams or use the checklist. Completed prerequisites unlock work.

All projects and edits stay in this installation's SQLite database. There are no
login accounts or cloud synchronization. Teams and engineers are assignment labels.

### Reusable project templates

Open a project and choose **Save as template** beside its title or in the sidebar.
Give the template a unique name and an optional description. In **New project →
Start from → Saved templates**, choose the workflow you want to reuse.

Templates copy steps, substeps, decisions, dependencies, instructions, completion
criteria, and responsible teams. Progress, decision answers, impediments, and
engineer assignments reset. The source project, saved template, and new projects
are independent; later project edits do not update the template. Save another
named template to capture a revised workflow.

You can save and use workspace templates. Templates are
stored in SQLite, included in workspace exports and imports, and preserved
when older open clients save project edits. The built-in standard onboarding
remains available as a separate starting point.

### Teams and task assignments

Use **Teams & engineers** to create or rename teams, add engineers,
and choose their members. Engineers may belong to multiple teams. The task editor's
**Responsible team** dropdown filters engineer choices to that team. Assigning an
engineer adds them to the project's roster when the step is saved (up to 50 per
project). With no responsible team, the task can use the existing project roster.
Project settings also supports filtering engineers by team and adding a whole team.

Changing a task's team clears assignments outside the new team. Removing someone
from a team shows the affected assignment count before saving; their project
membership and task progress remain. Team renames update task labels across
projects. Existing free-text team labels migrate automatically, including the
engineers already assigned to those tasks. Teams and assignments persist in
SQLite and project/workspace exports.

Engineer records describe assignments; they are not login accounts.

### Rearranging substeps

Open a workstream and use the **Move up** / **Move down** arrows beside its
substeps. Order saves automatically for the shared project and is used in the
substep list and checklist. Moving a workstream among its siblings keeps its own
substeps together. Prerequisites, assignments, and progress keep their values.
The dependency map still arranges steps around their prerequisite relationships.

Reordering combines with concurrent task edits. Incompatible simultaneous order
changes show a conflict for review instead of silently replacing an engineer's
chosen order in another tab.

### Deleting steps

Open a step and choose **Delete step** next to **Change status**. Review the
confirmation, then delete. Deleting a workstream also removes all its nested
substeps. The confirmation lists them and the remaining steps whose prerequisite
links will be removed. Those steps may become ready; other prerequisites and
impediments still apply. Deletion is permanent and does not have an undo action.

If a workstream loses its last substep, it becomes a regular step and retains its
displayed progress. A block caused only by a deleted substep's impediment is
removed. Deleting the final step leaves an empty project where you can add new
steps. Project engineers, teams, and other projects remain. Conflicting tab edits are
reviewed before any stale deletion can replace newer work.

### Decisions and conditional branches

Choose **Add decision**, enter a Yes/No question, and select the work that must
finish first under **Prerequisites**. After saving, use **Add step** under **If Yes**
or **If No** in the decision's details. Existing tasks can join a branch through
**Edit → Run only when → [decision] → Answer is**. Conditions apply to every
substep, so a database workstream can contain creation and configuration tasks.
Add ordinary prerequisite links between those substeps to put creation first.

For “Is a database needed?”, put the database workstream on **Yes** and leave **No**
empty. Before answering, its tasks show **Waiting for decision**. Yes makes that
work required; No makes it **Not needed** and excludes it from completion totals.
To rejoin the workflow, make the next shared step depend on the decision and the
branch workstream(s). Only the selected work must be completed. The map labels
conditional arrows Yes or No and gives decisions a distinct purple treatment.

Decision answers require completed prerequisites and count as completed steps.
They can be changed or cleared with a confirmation. Saved progress and impediments
on unselected branches are retained; reactivated work has its prerequisites
checked again. Downstream completed work may reopen when requirements change.
Reopening a decision's prerequisite clears its answer. Nested decisions are
supported, and contradictory conditions or dependency loops are rejected.

Answers and conditions persist in SQLite and exports. Creating a new project
or resetting progress clears answers. Deleting a decision lists the branches
whose conditions will be removed; they become ordinary required work. Older open clients must refresh before saving
a project with decisions, so they cannot accidentally remove the new fields.

### Not-needed work and impediments

Open a task and use **Change status**:

- **Mark as not needed** uses a gray skip icon. The task stays visible, is excluded
  from completion totals, and counts as resolved for dependencies. **Make required
  again** returns it to pending and recalculates dependent progress.
- **Add impediment** records the obstacle preventing required work from moving
  forward. A reason is required. The task uses a red lock indicator, remains in
  completion totals, and holds up dependent work. **Edit impediment** changes the
  reason; **Resolve impediment** returns the task to pending. Remaining
  prerequisites still apply.
- Dependency blocks are automatic and show **Waiting on prerequisites**. They
  clear when those prerequisites are complete or marked not needed. An impediment
  must be explicitly resolved, even after all prerequisites are satisfied.

Workstream status is calculated from its substeps. Marking a workstream not needed
applies to its active leaf tasks; decision answers and unselected branches keep
their saved values. Adding an impediment to a workstream applies only
to unfinished required substeps without an existing impediment; completed tasks,
not-needed tasks, and existing impediment reasons are preserved. Resolving a
workstream's impediments clears those impediments without changing its skipped or
completed substeps. An entirely skipped workstream shows **Not needed**, not a
completed percentage. Project copies and **Reset progress** start with all tasks
required and clear impediments. Exports preserve both states and their reasons.

### Saving and multiple tabs

Changes save automatically. The interface checks for updates every eight seconds
and when the tab regains focus. It checks a lightweight revision first, fetching
project data only when necessary. Refresh pauses while a form is open. Separate
field edits merge automatically. Overlapping changes produce a conflict notice
with the draft and saved values. Export the draft before loading the saved
version, then reapply the intended changes. A failed save never silently replaces
the server's data. The page warns before leaving with unsaved changes.

### Bring over browser projects

On the original prototype, use **Export → Export all projects**. In this app, use
**Import** to review and add that JSON file. Project progress, engineers, task
assignments, and dependencies are preserved. The original browser copy is kept.
Browsers isolate data by origin, so moving from a hosted address to this local installation requires this export/import step. If an old browser copy is present on the
same origin, the app offers **Review browser projects** directly.

For migration from the current cloud edition, use **Export workspace & templates**
there, then **Import** here. Changes remain independent after import.
