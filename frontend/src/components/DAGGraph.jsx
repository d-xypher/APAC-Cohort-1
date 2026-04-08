import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

/* ── Node ID extractor (handles object or primitive refs) ── */
const getNodeId = (nodeRef) => {
  if (typeof nodeRef === 'object' && nodeRef !== null) return nodeRef.id;
  return nodeRef;
};

/* ── Status-based visual style map ────────────────────────── */
const STATUS_STYLE = {
  scheduled: {
    fill: 'rgba(15, 15, 28, 0.85)',
    stroke: 'rgba(0, 229, 255, 0.35)',
    glow: 'rgba(0, 229, 255, 0.2)',
    text: '#8888a0',
  },
  in_progress: {
    fill: 'rgba(0, 143, 160, 0.2)',
    stroke: 'rgba(0, 229, 255, 0.7)',
    glow: 'rgba(0, 229, 255, 0.5)',
    text: '#00e5ff',
  },
  completed: {
    fill: 'rgba(52, 211, 153, 0.1)',
    stroke: 'rgba(52, 211, 153, 0.5)',
    glow: 'rgba(52, 211, 153, 0.3)',
    text: '#34d399',
  },
  blocked: {
    fill: 'rgba(248, 113, 113, 0.12)',
    stroke: 'rgba(248, 113, 113, 0.7)',
    glow: 'rgba(248, 113, 113, 0.5)',
    text: '#f87171',
  },
  rescheduled: {
    fill: 'rgba(251, 191, 36, 0.1)',
    stroke: 'rgba(251, 191, 36, 0.5)',
    glow: 'rgba(251, 191, 36, 0.3)',
    text: '#fbbf24',
  },
  focus_block: {
    fill: 'rgba(167, 139, 250, 0.12)',
    stroke: 'rgba(167, 139, 250, 0.6)',
    glow: 'rgba(167, 139, 250, 0.4)',
    text: '#a78bfa',
  },
};

const getNodeStatusStyle = (node) => {
  if (node.node_type === 'focus_block') return STATUS_STYLE.focus_block;
  if (node.cascade_note?.includes('DEADLINE VIOLATION')) return STATUS_STYLE.blocked;
  const key = String(node.status || '').toLowerCase();
  return STATUS_STYLE[key] || STATUS_STYLE.scheduled;
};

const formatNodeTime = (value) => {
  if (!value) return 'Unscheduled';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const clamp = (val, min, max) => Math.max(min, Math.min(val, max));

/* ── Main Component ───────────────────────────────────────── */
export const DAGGraph = ({
  nodesData,
  edgesData,
  cascadingNodeIds,
  selectedNodeId,
  onNodeSelect,
  onPreviewCascade,
  isLoading = false,
}) => {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [tooltip, setTooltip] = useState(null);

  /* Responsive container sizing */
  useEffect(() => {
    if (!containerRef.current) return;
    const measure = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        setDimensions({ width, height });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  /* D3 Force-Directed Graph */
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    if (!nodesData.length || dimensions.width === 0) return;

    const { width, height } = dimensions;

    // Deep-dark canvas
    svg.style('background', 'var(--bg-void)');

    const nodes = nodesData.map((d) => ({ ...d }));
    const nodeIds = new Set(nodes.map((n) => n.id));
    const links = edgesData
      .filter((d) => nodeIds.has(d.from_node_id) && nodeIds.has(d.to_node_id))
      .map((d) => ({ ...d, source: d.from_node_id, target: d.to_node_id }));

    /* Simulation */
    const simulation = d3
      .forceSimulation(nodes)
      .force('link', d3.forceLink(links).id((d) => d.id).distance(220))
      .force('charge', d3.forceManyBody().strength(-1400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('y', d3.forceY(height / 2).strength(0.08))
      .force('x', d3.forceX(width / 2).strength(0.08))
      .force('collision', d3.forceCollide().radius(90));

    /* SVG Defs: Filters & Markers */
    const defs = svg.append('defs');

    // Glow filter
    const glow = defs.append('filter').attr('id', 'glow');
    glow.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'blur');
    const merge = glow.append('feMerge');
    merge.append('feMergeNode').attr('in', 'blur');
    merge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Stronger glow for cascading
    const glowStrong = defs.append('filter').attr('id', 'glow-strong');
    glowStrong.append('feGaussianBlur').attr('stdDeviation', '6').attr('result', 'blur');
    const mergeStrong = glowStrong.append('feMerge');
    mergeStrong.append('feMergeNode').attr('in', 'blur');
    mergeStrong.append('feMergeNode').attr('in', 'SourceGraphic');

    // Arrow marker
    defs
      .append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 90)
      .attr('refY', 0)
      .attr('markerWidth', 5)
      .attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-4L10,0L0,4')
      .attr('fill', 'rgba(255,255,255,0.15)');

    // Cascading arrow marker
    defs
      .append('marker')
      .attr('id', 'arrow-cascade')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 90)
      .attr('refY', 0)
      .attr('markerWidth', 5)
      .attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-4L10,0L0,4')
      .attr('fill', 'var(--warning)');

    // Click on canvas to deselect
    svg.on('click', () => {
      if (onNodeSelect) onNodeSelect(null);
    });

    const g = svg.append('g');

    // Zoom + pan
    const zoomBehavior = d3
      .zoom()
      .scaleExtent([0.25, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });
    svg.call(zoomBehavior);

    /* ── Edges ── */
    const link = g
      .append('g')
      .selectAll('path')
      .data(links)
      .join('path')
      .attr('fill', 'none')
      .attr('stroke', (d) =>
        cascadingNodeIds.includes(getNodeId(d.target))
          ? 'var(--warning)'
          : 'rgba(255, 255, 255, 0.06)'
      )
      .attr('stroke-width', (d) =>
        cascadingNodeIds.includes(getNodeId(d.target)) ? 2.5 : 1.2
      )
      .style('opacity', (d) =>
        cascadingNodeIds.includes(getNodeId(d.target)) ? 0.9 : 0.5
      )
      .style('filter', (d) =>
        cascadingNodeIds.includes(getNodeId(d.target)) ? 'url(#glow)' : 'none'
      )
      .attr('marker-end', (d) =>
        cascadingNodeIds.includes(getNodeId(d.target))
          ? 'url(#arrow-cascade)'
          : 'url(#arrow)'
      );

    /* ── Nodes ── */
    const rectW = 170;
    const rectH = 64;

    const node = g
      .append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .style('cursor', 'pointer')
      .call(drag(simulation))
      .on('mouseover', (event, d) => {
        const rect = containerRef.current?.getBoundingClientRect();
        setTooltip({
          x: rect ? event.clientX - rect.left : event.clientX,
          y: rect ? event.clientY - rect.top : event.clientY,
          data: d,
        });
      })
      .on('mouseout', () => setTooltip(null))
      .on('click', (event, d) => {
        event.stopPropagation();
        if (onNodeSelect) onNodeSelect(d);
      });

    // Node background rect
    node
      .append('rect')
      .attr('width', rectW)
      .attr('height', rectH)
      .attr('x', -rectW / 2)
      .attr('y', -rectH / 2)
      .attr('rx', 10)
      .attr('fill', (d) => getNodeStatusStyle(d).fill)
      .attr('stroke', (d) =>
        selectedNodeId === d.id
          ? 'var(--magenta)'
          : cascadingNodeIds.includes(d.id)
          ? 'var(--warning)'
          : getNodeStatusStyle(d).stroke
      )
      .attr('stroke-width', (d) =>
        selectedNodeId === d.id || cascadingNodeIds.includes(d.id) ? 1.5 : 0.8
      )
      .style('filter', (d) => {
        if (cascadingNodeIds.includes(d.id)) return 'url(#glow-strong)';
        if (selectedNodeId === d.id) return 'url(#glow)';
        return 'none';
      })
      .style('transition', 'all 200ms ease');

    // Title text
    node
      .append('text')
      .attr('dy', -6)
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--text-primary)')
      .attr('font-size', '12.5px')
      .attr('font-family', 'Inter, sans-serif')
      .attr('font-weight', '600')
      .text((d) => (d.title.length > 22 ? `${d.title.substring(0, 22)}…` : d.title));

    // Time label
    node
      .append('text')
      .attr('dy', 14)
      .attr('text-anchor', 'middle')
      .attr('fill', (d) => getNodeStatusStyle(d).text)
      .attr('font-size', '10.5px')
      .attr('font-family', "'JetBrains Mono', monospace")
      .attr('font-weight', '400')
      .text((d) => formatNodeTime(d.start_time));

    // Small status dot
    node
      .append('circle')
      .attr('cx', -rectW / 2 + 10)
      .attr('cy', -rectH / 2 + 10)
      .attr('r', 3)
      .attr('fill', (d) => getNodeStatusStyle(d).stroke)
      .style('filter', (d) => {
        const style = getNodeStatusStyle(d);
        return `drop-shadow(0 0 3px ${style.glow})`;
      });

    /* ── Tick ── */
    simulation.on('tick', () => {
      link.attr('d', (d) => {
        const dx = d.target.x - d.source.x;
        const dy = d.target.y - d.source.y;
        const dr = Math.sqrt(dx * dx + dy * dy) * 1.4;
        return `M${d.source.x},${d.source.y}A${dr},${dr} 0 0,1 ${d.target.x},${d.target.y}`;
      });
      node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    /* ── Drag behavior ── */
    let dragTimeout = null;
    function drag(sim) {
      function started(event) {
        if (!event.active) sim.alphaTarget(0.3).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
      }
      function dragged(event) {
        event.subject.fx = event.x;
        event.subject.fy = event.y;
        if (onPreviewCascade) {
          clearTimeout(dragTimeout);
          dragTimeout = setTimeout(() => {
            onPreviewCascade(event.subject.id, new Date());
          }, 100);
        }
      }
      function ended(event) {
        if (!event.active) sim.alphaTarget(0);
        event.subject.fx = null;
        event.subject.fy = null;
      }
      return d3.drag().on('start', started).on('drag', dragged).on('end', ended);
    }

    return () => simulation.stop();
  }, [nodesData, edgesData, cascadingNodeIds, selectedNodeId, dimensions, onNodeSelect, onPreviewCascade]);

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        position: 'relative',
        background: 'var(--bg-void)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}
    >
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ position: 'absolute', top: 0, left: 0 }}
      />

      {/* Loading state */}
      {isLoading && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 14,
            color: 'var(--cyan)',
            fontSize: '0.78rem',
            fontFamily: "var(--font-mono)",
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span className="spin" style={{ display: 'inline-block', width: 12, height: 12 }}>
            ◎
          </span>
          Computing cascade...
        </div>
      )}

      {/* Empty state */}
      {!isLoading && nodesData.length === 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-tertiary)',
            fontSize: '0.85rem',
          }}
        >
          No graph data yet. Seed demo data to begin.
        </div>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div
          style={{
            position: 'absolute',
            left: clamp(tooltip.x + 16, 10, Math.max(10, dimensions.width - 260)),
            top: clamp(tooltip.y + 16, 10, Math.max(10, dimensions.height - 180)),
            minWidth: 220,
            background: 'var(--glass-bg-heavy)',
            backdropFilter: 'blur(16px)',
            border: '1px solid var(--glass-border)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 12px',
            boxShadow: 'var(--shadow-lg)',
            pointerEvents: 'none',
            zIndex: 50,
            fontSize: '0.78rem',
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem', marginBottom: 6 }}>
            {tooltip.data.title}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--text-tertiary)' }}>Type</span>
            <span>{tooltip.data.node_type}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--text-tertiary)' }}>Status</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {tooltip.data.status}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--text-tertiary)' }}>Start</span>
            <span style={{ fontFamily: "var(--font-mono)" }}>{formatNodeTime(tooltip.data.start_time)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--text-tertiary)' }}>End</span>
            <span style={{ fontFamily: "var(--font-mono)" }}>{formatNodeTime(tooltip.data.end_time)}</span>
          </div>
          {tooltip.data.cascade_note && (
            <div
              style={{
                marginTop: 8,
                padding: '6px 8px',
                fontSize: '0.72rem',
                color: 'var(--warning)',
                background: 'var(--warning-dim)',
                border: '1px solid rgba(251, 191, 36, 0.2)',
                borderRadius: 'var(--radius-sm)',
                fontStyle: 'italic',
              }}
            >
              {tooltip.data.cascade_note}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
