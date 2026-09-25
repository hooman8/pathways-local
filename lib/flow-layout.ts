import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode } from "elkjs/lib/elk-api";
import type { ApplicationFlow } from "./application-flow";

export type FlowLayout = {
  nodes: { id: string; x: number; y: number; inputX: number; outputX: number }[];
  edges: { id: string; points: { x: number; y: number }[]; labelPosition?: { x: number; y: number } }[];
};
let elk: InstanceType<typeof ELK> | undefined;
export async function layoutFlow(flow: Pick<ApplicationFlow, "nodes" | "edges">): Promise<FlowLayout> {
  elk ??= new ELK();
  const graph: ElkNode = {
    id: "flow:root",
    layoutOptions: {
      "elk.algorithm": "layered", "elk.direction": "DOWN", "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "40", "elk.layered.spacing.nodeNodeBetweenLayers": "100",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES", "elk.padding": "[top=24,left=24,bottom=24,right=24]",
    },
    children: flow.nodes.map(node => ({ id: node.id, width: 240, height: 124,
      layoutOptions: { "elk.portConstraints": "FIXED_SIDE", "elk.portAlignment.default": "CENTER" },
      ports: [{ id: `${node.id}:in`, layoutOptions: { "elk.port.side": "NORTH" } }, { id: `${node.id}:out`, layoutOptions: { "elk.port.side": "SOUTH" } }],
    })),
    edges: flow.edges.map(edge => ({ id: edge.id, sources: [`${edge.source}:out`], targets: [`${edge.target}:in`],
      ...(edge.label ? { labels: [{ text: edge.label, width: Math.max(45, Math.min(850, edge.label.length * 7.2)), height: 22, layoutOptions: { "elk.edgeLabels.placement": "CENTER", "elk.edgeLabels.inline": "true" } }] } : {}),
    })),
  };
  const result = await elk.layout(graph);
  return {
    nodes: (result.children ?? []).map(node => ({ id: node.id, x: node.x ?? 0, y: node.y ?? 0,
      inputX: node.ports?.find(port => port.id === `${node.id}:in`)?.x ?? 120,
      outputX: node.ports?.find(port => port.id === `${node.id}:out`)?.x ?? 120,
    })),
    edges: (result.edges ?? []).map(edge => ({ id: edge.id,
      points: (edge.sections ?? []).flatMap(section => [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]),
      ...(edge.labels?.[0]?.x !== undefined ? { labelPosition: { x: edge.labels[0].x! + (edge.labels[0].width ?? 0) / 2, y: (edge.labels[0].y ?? 0) + 11 } } : {}),
    })),
  };
}
