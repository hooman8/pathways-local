"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, MarkerType, BaseEdge, useReactFlow, type Node, type NodeProps, type Edge, type EdgeProps } from "@xyflow/react";
import { ArrowRight, CircleCheck, Database, GitBranch, Layers3, Play, Server, Timer, UserRound, Workflow, Maximize2, Monitor, Boxes, ListOrdered, HardDrive, Globe, Cloud } from "lucide-react";
import { type ApplicationFlow, type FlowNode } from "@/lib/application-flow";
import { layoutFlow, type FlowLayout } from "@/lib/flow-layout";
import { COMPONENT_WIDTH, COMPONENT_HEIGHT } from "@/lib/architecture-layout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import "@xyflow/react/dist/style.css";

const icons = { start: Play, human: UserRound, process: Workflow, decision: GitBranch, api: Server, database: Database, timer: Timer, subflow: Layers3, end: CircleCheck, frontend: Monitor, service: Boxes, queue: ListOrdered, cache: HardDrive, external: Globe, infrastructure: Cloud };
type Card = Node<{ step: FlowNode; inputX: number; outputX: number; selected: boolean; boundary: boolean; architecture: boolean }, "flowStep">;
type DeviceGroup = Node<{ group: NonNullable<FlowLayout["groups"]>[number] }, "deviceGroup">;
function GroupCard({ data }: NodeProps<DeviceGroup>) {
  return <section className="flow-device-group" aria-label={`${data.group.title} components`}>
    <h2>{data.group.title}</h2>{data.group.description && <p>{data.group.description}</p>}
  </section>;
}
function FlowCard({ data }: NodeProps<Card>) {
  const Icon = icons[data.step.kind];
  return <div className={`flow-card flow-kind-${data.step.kind}${data.architecture ? " flow-architecture-card" : ""}${data.selected ? " flow-selected" : ""}${data.boundary ? " flow-boundary" : ""}`}>
    <Handle type="target" position={Position.Top} style={{ left: data.inputX, ...(data.architecture ? { opacity: 0 } : {}) }} isConnectable={false} />
    <div className="flow-card-kind"><Icon size={14} /><span>{data.step.kind}</span></div>
    <strong>{data.step.title}</strong><span className="flow-card-actor">{data.step.actor || data.step.phase}</span>
    <Handle type="source" position={Position.Bottom} style={{ left: data.outputX, ...(data.architecture ? { opacity: 0 } : {}) }} isConnectable={false} />
  </div>;
}
const nodeTypes = { flowStep: FlowCard, deviceGroup: GroupCard };
type RoutedEdge = Edge<{ route: FlowLayout["edges"][number]; architecture: boolean }, "flowRoute">;
function Connector({ id, data, label, markerEnd, markerStart, style }: EdgeProps<RoutedEdge>) {
  if (!data?.route.points.length) return null;
  const path = data.route.points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} label={label}
    labelX={data.route.labelPosition?.x} labelY={data.route.labelPosition?.y}
    markerStart={markerStart} labelStyle={{ fontSize: data.architecture ? 18 : 12, fontWeight: 600, fill: style?.stroke }} labelBgStyle={{ fill: "#ffffff" }} labelBgPadding={[7, 4]} />;
}
const edgeTypes = { flowRoute: Connector };
const emptyLayout: FlowLayout = { nodes: [], edges: [] };
function Canvas({ flow, phase, selected, onSelect, canExpand = true }: { flow: ApplicationFlow; phase: string; selected: string | null; onSelect: (id: string | null) => void; canExpand?: boolean }) {
  const [result, setResult] = useState<{ flow: ApplicationFlow; layout: FlowLayout; error: string } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const architecture = flow.diagramType === "architecture";
  const container = useRef<HTMLDivElement>(null);
  const { fitView, setViewport, setCenter } = useReactFlow();
  const visible = useMemo(() => {
    if (!phase) return flow;
    const focus = new Set(flow.nodes.filter(node => architecture ? node.groupId === phase : node.phase === phase).map(node => node.id));
    const ids = new Set(focus);
    flow.edges.forEach(edge => { if (focus.has(edge.source)) ids.add(edge.target); if (focus.has(edge.target)) ids.add(edge.source); });
    return { ...flow, nodes: flow.nodes.filter(node => ids.has(node.id)), edges: flow.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)),
      ...(flow.groups ? { groups: flow.groups.filter(group => flow.nodes.some(node => ids.has(node.id) && node.groupId === group.id)) } : {}) };
  }, [flow, phase, architecture]);
  const layout = result?.flow === visible ? result.layout : emptyLayout;
  const error = result?.flow === visible ? result.error : "";
  useEffect(() => {
    let current = true;
    layoutFlow(visible).then(layout => { if (current) setResult({ flow: visible, layout, error: "" }); }).catch(() => { if (current) setResult({ flow: visible, layout: emptyLayout, error: "The map could not be arranged. Open the details list to inspect this diagram." }); });
    return () => { current = false; };
  }, [visible]);
  useEffect(() => {
    const element = container.current;
    if (!element || !layout.nodes.length) return;
    const arrange = () => {
      const chosen = layout.nodes.find(node => node.id === selected);
      if (chosen) { void setCenter(chosen.x + (architecture ? COMPONENT_WIDTH / 2 : 120), chosen.y + (architecture ? COMPONENT_HEIGHT / 2 : 62), { zoom: 0.9 }); return; }
      if (architecture) {
        const groups = layout.groups ?? [];
        const width = Math.max(...groups.map(group => group.x + group.width)) - Math.min(...groups.map(group => group.x));
        const height = Math.max(...groups.map(group => group.y + group.height)) - Math.min(...groups.map(group => group.y));
        if (Math.min((element.clientWidth - 40) / width, (element.clientHeight - 40) / height) >= 0.6) {
          void fitView({ padding: 0.05, maxZoom: 1, minZoom: 0.65 });
        } else {
          // Start with a readable component rather than centering a narrow
          // viewport in the gap between distant system groups.
          const first = layout.nodes[0];
          void setViewport({ x: element.clientWidth / 2 - (first.x + COMPONENT_WIDTH / 2) * 0.85, y: 110 - first.y * 0.85, zoom: 0.85 });
        }
        return;
      }
      const xs = layout.nodes.map(node => node.x), ys = layout.nodes.map(node => node.y);
      const fit = Math.min((element.clientWidth - 80) / (Math.max(...xs) - Math.min(...xs) + 240), (element.clientHeight - 90) / (Math.max(...ys) - Math.min(...ys) + 124));
      if (fit >= 0.65) { void fitView({ padding: 0.12, maxZoom: 1 }); return; }
      // Keep large flows readable on first load, with the first visible step at
      // the top. The standard Fit View control still shows the complete map.
      const first = layout.nodes.reduce((a, b) => a.y <= b.y ? a : b);
      void setViewport({ x: element.clientWidth / 2 - (first.x + 120) * 0.85, y: 70 - first.y * 0.85, zoom: 0.85 });
    };
    const timer = setTimeout(arrange, 80), observer = new ResizeObserver(arrange);
    observer.observe(element);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [layout, selected, fitView, setViewport, setCenter, architecture]);
  const groups: DeviceGroup[] = (layout.groups ?? []).map(group => ({ id: `group:${group.id}`, type: "deviceGroup", position: { x: group.x, y: group.y },
    style: { width: group.width, height: group.height }, zIndex: 0, selectable: false, data: { group } }));
  const cards: Card[] = layout.nodes.map(node => {
    const parent = layout.groups?.find(group => group.id === node.groupId);
    return { id: node.id, type: "flowStep", position: { x: node.x - (parent?.x ?? 0), y: node.y - (parent?.y ?? 0) },
      style: { width: architecture ? COMPONENT_WIDTH : 240, height: architecture ? COMPONENT_HEIGHT : 124 },
      ...(parent ? { parentId: `group:${parent.id}`, extent: "parent" as const, zIndex: 2 } : {}),
      data: { step: flow.nodes.find(step => step.id === node.id)!, inputX: node.inputX, outputX: node.outputX, selected: node.id === selected,
        boundary: !!phase && (architecture ? node.groupId !== phase : flow.nodes.find(step => step.id === node.id)?.phase !== phase), architecture },
    };
  });
  const nodes = [...groups, ...cards];
  const edges: RoutedEdge[] = layout.edges.map(route => {
    const edge = flow.edges.find(edge => edge.id === route.id)!;
    const acrossGroups = architecture && flow.nodes.find(node => node.id === edge.source)?.groupId !== flow.nodes.find(node => node.id === edge.target)?.groupId;
    const color = acrossGroups ? "#285d9b" : edge.kind === "error" ? "#bc5353" : edge.kind === "retry" ? "#b87619" : edge.kind === "branch" ? "#7752ab" : "#597691";
    const marker = { type: MarkerType.ArrowClosed, color, width: architecture ? 22 : 16, height: architecture ? 22 : 16 };
    return { ...edge, type: "flowRoute", data: { route, architecture }, markerEnd: marker,
      ...(edge.direction === "both" ? { markerStart: marker } : {}), ...(architecture ? { zIndex: 1 } : {}),
      style: { stroke: color, strokeWidth: acrossGroups ? 3 : 1.8, ...(edge.kind === "retry" ? { strokeDasharray: "6 4" } : {}) } };
  });
  return <div ref={container} className={`application-flow-canvas${architecture ? " architecture-canvas" : ""}`} aria-label={architecture ? "Grouped architecture diagram" : "Application flow diagram"}>
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
      minZoom={architecture ? 0.65 : 0.08} maxZoom={1.8} onNodeClick={(_, node) => { if (node.type === "flowStep") onSelect(node.id); }} onPaneClick={() => onSelect(null)} colorMode="light">
      <Background gap={24} size={1} color="#dbe1e6" /><Controls showInteractive={false} />{!architecture && <MiniMap pannable zoomable nodeColor="#d9e3e6" />}
    </ReactFlow>
    <div className="flow-canvas-help"><ArrowRight size={14} />{architecture ? "Select a component for details." : "Select a step for details."} Scroll to zoom; drag to pan.</div>
    {canExpand && <><Button className="flow-expand" variant="outline" size="icon" aria-label="Expand diagram" onClick={() => setExpanded(true)}><Maximize2 size={17} /></Button>
      <Dialog open={expanded} onOpenChange={setExpanded}><DialogContent className="flow-expanded-dialog"><DialogHeader><DialogTitle>{flow.name}</DialogTitle><DialogDescription className="sr-only">Expanded diagram. Pan or zoom to inspect components; press Escape or Close to return.</DialogDescription></DialogHeader>
        <ReactFlowProvider><Canvas flow={flow} phase={phase} selected={selected} onSelect={onSelect} canExpand={false} /></ReactFlowProvider>
      </DialogContent></Dialog></>}
    {!canExpand && selected && <aside className="flow-expanded-selection" aria-live="polite"><strong>{flow.nodes.find(node => node.id === selected)?.title}</strong><p>{flow.nodes.find(node => node.id === selected)?.description}</p></aside>}
    {!layout.nodes.length && <div className="flow-layout-message" role={error ? "alert" : "status"}>{error || "Arranging flow…"}</div>}
  </div>;
}
export default function FlowCanvas(props: Parameters<typeof Canvas>[0]) { return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>; }
