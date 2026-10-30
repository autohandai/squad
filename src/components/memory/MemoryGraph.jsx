import { useEffect, useMemo, useRef, useState } from "react";
import { Focus, Minus, Plus, Scan } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fitMemoryGraph, layoutMemoryGraph } from "@/lib/memory-graph";

export function MemoryGraph({ records, members, groups, grouping, colors, links, selectedId, onSelect }) {
  const host = useRef(null), gesture = useRef(null), svg = useRef(null);
  const [size, setSize] = useState({ width: 1100, height: 690 });
  const [view, setView] = useState({ x: 550, y: 345, scale: 1 });
  const [hover, setHover] = useState('');
  const [dragging, setDragging] = useState(false);
  const [positions, setPositions] = useState({});
  const layout = useMemo(() => layoutMemoryGraph(records, members, groups, grouping, colors), [records, members, groups, grouping, colors]);
  const nodes = useMemo(() => layout.nodes.map(node => positions[node.id] ? { ...node, ...positions[node.id] } : node), [layout, positions]);
  const byId = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  const allLinks = useMemo(() => [...layout.links, ...links], [layout, links]);
  const active = hover || selectedId;
  const neighbors = useMemo(() => {
    const ids = new Set(active ? [active] : []);
    for (const link of allLinks) { if (link.from === active) ids.add(link.to); if (link.to === active) ids.add(link.from); }
    return ids;
  }, [active, allLinks]);
  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      const box = entries[0].contentRect;
      setSize({ width: Math.max(200, box.width), height: Math.max(300, box.height) });
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const graphKey = `${grouping}:${layout.clusters.map(item => item.key).join(',')}`;
  useEffect(() => { setPositions({}); setView(fitMemoryGraph(layout.nodes, size.width, size.height)); }, [graphKey, size.width, size.height]); // fit on grouping/resize, preserve a person's pan during source refresh

  function zoom(factor, point = { x: size.width / 2, y: size.height / 2 }) {
    setView(current => {
      const scale = Math.min(6, Math.max(0.12, current.scale * factor));
      return { scale, x: point.x - (point.x - current.x) * scale / current.scale, y: point.y - (point.y - current.y) * scale / current.scale };
    });
  }
  useEffect(() => {
    const element = svg.current;
    const wheel = event => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoom(Math.exp(-event.deltaY * 0.0015), { x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  function focus(id) {
    const node = byId.get(id);
    if (!node) return;
    setView({ scale: 2.2, x: size.width / 2 - node.x * 2.2, y: size.height / 2 - node.y * 2.2 });
  }
  function begin(event, node) {
    if (event.button !== 0) return;
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    gesture.current = { id: node?.id, cluster: node?.cluster ? nodes.filter(item => item.clusterId === node.id) : null, clientX: event.clientX, clientY: event.clientY, x: node?.x ?? view.x, y: node?.y ?? view.y, scale: view.scale, moved: false };
  }
  function move(event) {
    const current = gesture.current;
    if (!current) return;
    const dx = event.clientX - current.clientX, dy = event.clientY - current.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 3) current.moved = true;
    if (current.cluster) setPositions(value => ({ ...value, ...Object.fromEntries(current.cluster.map(item => [item.id, { x: item.x + dx / current.scale, y: item.y + dy / current.scale }])) }));
    else if (current.id) setPositions(value => ({ ...value, [current.id]: { x: current.x + dx / current.scale, y: current.y + dy / current.scale } }));
    else setView(value => ({ ...value, x: current.x + dx, y: current.y + dy }));
  }
  function end(event, node) {
    const current = gesture.current;
    if (!current) return;
    if (!current.moved && node) { if (node.cluster) focus(node.id); else onSelect(node.id); }
    gesture.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <div ref={host} className="memory-graph relative min-h-[420px] flex-1 overflow-hidden" data-testid="memory-graph">
    <svg ref={svg} width="100%" height="100%" className="absolute inset-0 touch-none outline-none" role="group" aria-label="Interactive memory graph. Drag to pan, scroll to zoom, or use the controls. Each memory is keyboard accessible." tabIndex={0}
      onPointerDown={event => begin(event)} onPointerMove={move} onPointerUp={event => end(event)} onPointerCancel={() => { gesture.current = null; setDragging(false); }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        const offsets = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
        if (offsets[event.key]) { event.preventDefault(); const [x, y] = offsets[event.key]; setView(current => ({ ...current, x: current.x + x, y: current.y + y })); }
        if (event.key === '+' || event.key === '=') zoom(1.25);
        if (event.key === '-') zoom(0.8);
      }}>
      <defs><pattern id="memory-dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.65" fill="currentColor" opacity="0.13" /></pattern></defs>
      <rect width="100%" height="100%" fill="url(#memory-dots)" className="text-muted-foreground" />
      <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`} className="memory-camera" style={dragging ? { transition: 'none' } : undefined}>
        {layout.clusters.map(original => { const cluster = { ...original, ...(positions[original.id] || {}) }; return <g key={cluster.id} pointerEvents="none" className="memory-cluster">
          <circle cx={cluster.x} cy={cluster.y} r={cluster.radius + 18} fill={cluster.color} fillOpacity="0.035" stroke={cluster.color} strokeOpacity="0.17" strokeDasharray="3 7" />
          <text x={cluster.x} y={cluster.y - cluster.radius - 29} textAnchor="middle" fill="currentColor" className="text-foreground" fontSize="13" fontWeight="500">{cluster.name}<tspan opacity="0.4" fontSize="10"> · {cluster.count}</tspan></text>
        </g>; })}
        {allLinks.map(link => {
          const from = byId.get(link.from), to = byId.get(link.to);
          if (!from || !to) return null;
          const related = link.from === active || link.to === active;
          return <line key={link.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={link.relation === 'contradicts' ? '#ce7184' : from.color}
            strokeWidth={related ? 1.8 : link.structure ? 0.7 : 1.1} strokeOpacity={active ? related ? 0.85 : 0.06 : link.structure ? 0.18 : 0.4} strokeDasharray={link.derived ? '4 5' : undefined} pointerEvents="none" vectorEffect="non-scaling-stroke"><title>{link.derived ? 'Computed text similarity' : link.relation}{link.evidence ? `: ${link.evidence}` : ''}</title></line>;
        })}
        {nodes.map(node => {
          const selected = selectedId === node.id, highlighted = active === node.id;
          const faded = active && !neighbors.has(node.id);
          return <g key={node.id} role="button" tabIndex={0} data-memory-node={node.id} aria-label={node.cluster ? `Focus ${node.title} group, ${layout.clusters.find(item => item.id === node.id)?.count} memories` : `Open memory: ${node.title}`} aria-pressed={selected} transform={`translate(${node.x} ${node.y})`} className="memory-node cursor-pointer outline-none" opacity={faded ? 0.3 : 1}
            onPointerDown={event => begin(event, node)} onPointerMove={move} onPointerUp={event => { event.stopPropagation(); end(event, node); }}
            onMouseEnter={() => setHover(node.id)} onMouseLeave={() => setHover('')}
            onDoubleClick={event => { event.stopPropagation(); focus(node.id); }}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); if (node.cluster) focus(node.id); else onSelect(node.id); } if (event.key === 'f') { event.stopPropagation(); focus(node.id); } }}>
            <title>{node.title}{node.cluster ? '' : `\n${node.record.text.slice(0, 300)}`}</title>
            <circle r={Math.max(14, node.radius + 5)} fill="transparent" />
            {selected || highlighted ? <circle r={node.radius + 5} fill="none" stroke={node.color} strokeWidth="1" opacity="0.5" /> : null}
            <circle r={node.radius} fill={node.cluster ? 'var(--background)' : node.color} fillOpacity={node.cluster ? 1 : 0.85} stroke={node.color} strokeWidth={selected ? 2.5 : node.cluster ? 2 : 1} />
            {node.cluster ? <text textAnchor="middle" dominantBaseline="central" fill={node.color} fontSize="15" fontWeight="600">{node.title.slice(0, 1)}</text> : null}
            {!node.cluster && (highlighted || selected || view.scale > 1.75) ? <text x={node.radius + 9} y="4" fontSize="11" fill="currentColor" className="text-foreground memory-node-label" pointerEvents="none">{node.title.slice(0, 43)}{node.title.length > 43 ? '…' : ''}</text> : null}
          </g>;
        })}
      </g>
    </svg>
    <div className="absolute bottom-4 right-4 flex items-center gap-1 rounded-md border bg-background/95 p-1" aria-label="Graph controls">
      <Button variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={() => zoom(0.8)}><Minus className="size-4" /></Button>
      <output className="w-11 text-center text-xs tabular-nums" aria-label="Graph zoom">{Math.round(view.scale * 100)}%</output>
      <Button variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={() => zoom(1.25)}><Plus className="size-4" /></Button>
      <span className="mx-1 h-4 border-l" />
      <Button variant="ghost" size="icon-sm" aria-label="Fit all memories" onClick={() => { setPositions({}); setView(fitMemoryGraph(layout.nodes, size.width, size.height)); }}><Scan className="size-4" /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Focus selected memory" disabled={!selectedId} onClick={() => focus(selectedId)}><Focus className="size-4" /></Button>
    </div>
    <p className="pointer-events-none absolute bottom-5 left-5 hidden text-[11px] text-muted-foreground sm:block">Drag to explore · Scroll to zoom · Double-click to focus</p>
  </div>;
}
