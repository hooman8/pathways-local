"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, MarkerType, BaseEdge, useReactFlow, type Node, type NodeProps, type Edge, type EdgeProps } from "@xyflow/react";
import { ArrowRight, CircleCheck, Database, GitBranch, Layers3, Play, Server, Timer, UserRound, Workflow } from "lucide-react";
import { type ApplicationFlow, type FlowNode } from "@/lib/application-flow";
import { layoutFlow, type FlowLayout } from "@/lib/flow-layout";
import "@xyflow/react/dist/style.css";

const icons = { start: Play, human: UserRound, process: Workflow, decision: GitBranch, api: Server, database: Database, timer: Timer, subflow: Layers3, end: CircleCheck };
type Card = Node<{ step: FlowNode; inputX: number; outputX: number; selected: boolean; boundary: boolean }, "flowStep">;
function FlowCard({ data }: NodeProps<Card>) {
  const Icon = icons[data.step.kind];
  return <div className={`flow-card flow-kind-${data.step.kind}${data.selected ? " flow-selected" : ""}${data.boundary ? " flow-boundary" : ""}`}>
    <Handle type="target" position={Position.Top} style={{ left: data.inputX }} isConnectable={false} />
    <div className="flow-card-kind"><Icon size={14} /><span>{data.step.kind}</span></div>
    <strong>{data.step.title}</strong><span className="flow-card-actor">{data.step.actor || data.step.phase}</span>
    <Handle type="source" position={Position.Bottom} style={{ left: data.outputX }} isConnectable={false} />
  </div>;
}
const nodeTypes = { flowStep: FlowCard };
type RoutedEdge = Edge<{ route: FlowLayout["edges"][number] }, "flowRoute">;
function Connector({ id, data, label, markerEnd, style }: EdgeProps<RoutedEdge>) {
  if (!data?.route.points.length) return null;
  const path = data.route.points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} label={label}
    labelX={data.route.labelPosition?.x} labelY={data.route.labelPosition?.y}
    labelStyle={{ fontSize: 12, fontWeight: 600, fill: style?.stroke }} labelBgStyle={{ fill: "#ffffff" }} labelBgPadding={[7, 4]} />;
}
const edgeTypes = { flowRoute: Connector };
const emptyLayout: FlowLayout = { nodes: [], edges: [] };
function Canvas({ flow, phase, selected, onSelect }: { flow: ApplicationFlow; phase: string; selected: string | null; onSelect: (id: string | null) => void }) {
  const [result, setResult] = useState<{ flow: Pick<ApplicationFlow, "nodes" | "edges">; layout: FlowLayout; error: string } | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const { fitView, setViewport, setCenter } = useReactFlow();
  const visible = useMemo(() => {
    if (!phase) return flow;
    const focus = new Set(flow.nodes.filter(node => node.phase === phase).map(node => node.id));
    const ids = new Set(focus);
    flow.edges.forEach(edge => { if (focus.has(edge.source)) ids.add(edge.target); if (focus.has(edge.target)) ids.add(edge.source); });
    return { ...flow, nodes: flow.nodes.filter(node => ids.has(node.id)), edges: flow.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)) };
  }, [flow, phase]);
  const layout = result?.flow === visible ? result.layout : emptyLayout;
  const error = result?.flow === visible ? result.error : "";
  useEffect(() => {
    let current = true;
    layoutFlow(visible).then(layout => { if (current) setResult({ flow: visible, layout, error: "" }); }).catch(() => { if (current) setResult({ flow: visible, layout: emptyLayout, error: "The map could not be arranged. Open Steps to inspect this flow." }); });
    return () => { current = false; };
  }, [visible]);
  useEffect(() => {
    const element = container.current;
    if (!element || !layout.nodes.length) return;
    const arrange = () => {
      const chosen = layout.nodes.find(node => node.id === selected);
      if (chosen) { void setCenter(chosen.x + 120, chosen.y + 62, { zoom: 0.9 }); return; }
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
  }, [layout, selected, fitView, setViewport, setCenter]);
  const nodes: Card[] = layout.nodes.map(node => ({ id: node.id, type: "flowStep", position: { x: node.x, y: node.y }, style: { width: 240, height: 124 },
    data: { step: flow.nodes.find(step => step.id === node.id)!, inputX: node.inputX, outputX: node.outputX, selected: node.id === selected, boundary: !!phase && flow.nodes.find(step => step.id === node.id)?.phase !== phase },
  }));
  const edges: RoutedEdge[] = layout.edges.map(route => {
    const edge = flow.edges.find(edge => edge.id === route.id)!;
    const color = edge.kind === "error" ? "#bc5353" : edge.kind === "retry" ? "#b87619" : edge.kind === "branch" ? "#7752ab" : "#597691";
    return { ...edge, type: "flowRoute", data: { route }, markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 }, style: { stroke: color, strokeWidth: 1.8, ...(edge.kind === "retry" ? { strokeDasharray: "6 4" } : {}) } };
  });
  return <div ref={container} className="application-flow-canvas" aria-label="Application flow diagram">
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
      minZoom={0.08} maxZoom={1.8} onNodeClick={(_, node) => onSelect(node.id)} onPaneClick={() => onSelect(null)} colorMode="light">
      <Background gap={24} size={1} color="#dbe1e6" /><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor="#d9e3e6" />
    </ReactFlow>
    <div className="flow-canvas-help"><ArrowRight size={14} />Select a step for details. Scroll to zoom; drag to pan.</div>
    {!layout.nodes.length && <div className="flow-layout-message" role={error ? "alert" : "status"}>{error || "Arranging flow…"}</div>}
  </div>;
}
export default function FlowCanvas(props: Parameters<typeof Canvas>[0]) { return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>; }
