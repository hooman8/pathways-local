import type { ApplicationFlow } from "./application-flow";
import { clearConnector, connectorLabel, type Obstacle, type Point } from "./connector-routing";

export const COMPONENT_WIDTH = 320;
export const COMPONENT_HEIGHT = 112;
const PADDING = 32, HEADER = 90, COLUMN_GAP = 100, ROW_GAP = 72, GROUP_GAP = 220;
export type ArchitectureGroup = { id: string; title: string; description: string; x: number; y: number; width: number; height: number };

export function layoutArchitecture(flow: ApplicationFlow) {
  let nextX = 24;
  // Adjacent columns need enough room for a connection's complete label.
  // Otherwise a valid graph can have no collision-free label position.
  const columnGap = Math.max(COLUMN_GAP, ...flow.edges.map(edge => edge.label.length * 9 + 48));
  const groupGap = Math.max(GROUP_GAP, columnGap);
  const groups: ArchitectureGroup[] = [];
  const nodes: { id: string; groupId: string; x: number; y: number; inputX: number; outputX: number }[] = [];
  for (const group of flow.groups ?? []) {
    const members = flow.nodes.filter(node => node.groupId === group.id), columns = members.length > 4 ? 2 : 1;
    const width = PADDING * 2 + columns * COMPONENT_WIDTH + (columns - 1) * columnGap;
    const rows = Math.ceil(members.length / columns);
    const height = HEADER + rows * COMPONENT_HEIGHT + Math.max(0, rows - 1) * ROW_GAP + PADDING;
    const box = { ...group, x: nextX, y: 24, width, height };
    groups.push(box);
    members.forEach((node, index) => nodes.push({ id: node.id, groupId: group.id,
      x: box.x + PADDING + (index % columns) * (COMPONENT_WIDTH + columnGap),
      y: box.y + HEADER + Math.floor(index / columns) * (COMPONENT_HEIGHT + ROW_GAP), inputX: 160, outputX: 160 }));
    nextX += width + groupGap;
  }
  const byId = new Map(nodes.map(node => [node.id, node]));
  const obstacles = nodes.map(node => ({ ...node, width: COMPONENT_WIDTH, height: COMPONENT_HEIGHT }));
  const labels: Obstacle[] = [];
  const edges = flow.edges.map(edge => {
    const source = byId.get(edge.source)!, target = byId.get(edge.target)!;
    let from: Point, to: Point, fromStub: Point, toStub: Point;
    if (source.x === target.x) {
      const downward = target.y > source.y;
      from = { x: source.x + COMPONENT_WIDTH / 2, y: source.y + (downward ? COMPONENT_HEIGHT : 0) };
      to = { x: target.x + COMPONENT_WIDTH / 2, y: target.y + (downward ? 0 : COMPONENT_HEIGHT) };
      fromStub = { ...from, y: from.y + (downward ? 24 : -24) };
      toStub = { ...to, y: to.y + (downward ? -24 : 24) };
    } else {
      const rightward = target.x > source.x;
      from = { x: source.x + (rightward ? COMPONENT_WIDTH : 0), y: source.y + COMPONENT_HEIGHT / 2 };
      to = { x: target.x + (rightward ? 0 : COMPONENT_WIDTH), y: target.y + COMPONENT_HEIGHT / 2 };
      fromStub = { ...from, x: from.x + (rightward ? 24 : -24) };
      toStub = { ...to, x: to.x + (rightward ? -24 : 24) };
    }
    const paddedCards = obstacles.map(node => ({ ...node, x: node.x - 10, y: node.y - 10, width: node.width + 20, height: node.height + 20 }));
    const points = [from, ...clearConnector([fromStub, toStub], paddedCards), to];
    const preferred = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    // Reserve the full text footprint, rather than the narrow decision-label footprint.
    const labelWidth = edge.label.length * 9 + 24;
    const labelObstacles = [...obstacles, ...labels].map(rect => ({ x: rect.x - Math.max(0, labelWidth / 2 - 22), y: rect.y - 6,
      width: rect.width + Math.max(0, labelWidth - 44), height: rect.height + 12 }));
    const labelPosition = edge.label ? connectorLabel(points, preferred, labelObstacles) : undefined;
    if (labelPosition) labels.push({ x: labelPosition.x - labelWidth / 2, y: labelPosition.y - 18, width: labelWidth, height: 36 });
    return { id: edge.id, points, ...(labelPosition ? { labelPosition } : {}) };
  });
  return { groups, nodes, edges };
}
