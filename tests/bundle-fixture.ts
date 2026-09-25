import { exportBundle } from "../lib/project-bundle";
import { migrateRoadmap } from "../lib/projects";
import { sampleRoadmap } from "../lib/sample-roadmap";
import { exampleFlow } from "./flow-fixture";
export function transferFixture() {
  const workspace = migrateRoadmap(sampleRoadmap), projectId = workspace.activeProjectId;
  const parent = { ...exampleFlow(), id: "overview", projectId }, detail = { ...exampleFlow(), id: "detail", projectId };
  parent.nodes.find(node => node.id === "work")!.kind = "subflow";
  parent.nodes.find(node => node.id === "work")!.subflowId = detail.id;
  return { workspace, bundle: exportBundle(workspace, projectId, [parent, detail]) };
}
