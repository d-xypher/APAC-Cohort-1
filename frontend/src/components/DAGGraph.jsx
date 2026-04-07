import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

const getNodeId = (nodeRef) => {
  if (typeof nodeRef === 'object' && nodeRef !== null) {
    return nodeRef.id;
  }
  return nodeRef;
};

const STATUS_STYLE = {
  scheduled: {
    fill: 'var(--status-scheduled-bg)',
    stroke: 'var(--status-scheduled-border)',
  },
  in_progress: {
    fill: 'var(--status-progress-bg)',
    stroke: 'var(--status-progress-border)',
  },
  completed: {
    fill: 'var(--status-completed-bg)',
    stroke: 'var(--status-completed-border)',
  },
  blocked: {
    fill: 'var(--status-blocked-bg)',
    stroke: 'var(--status-blocked-border)',
  },
  rescheduled: {
    fill: 'var(--status-rescheduled-bg)',
    stroke: 'var(--status-rescheduled-border)',
  },
  cancelled: {
    fill: 'var(--status-cancelled-bg)',
    stroke: 'var(--status-cancelled-border)',
  },
};

const getNodeStatusStyle = (status) => {
  const key = String(status || '').toLowerCase();
  return STATUS_STYLE[key] || {
    fill: 'var(--panel-bg)',
    stroke: 'var(--glass-border)',
  };
};

const formatNodeTime = (value) => {
  if (!value) {
    return 'Unscheduled';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Invalid time';
  }

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

export const DAGGraph = ({
  nodesData,
  edgesData,
  cascadingNodeIds,
  selectedNodeId,
  onNodeSelect,
  isLoading = false,
}) => {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [tooltip, setTooltip] = useState(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const { width, height } = containerRef.current.getBoundingClientRect();
    setDimensions({ width, height });

    const handleResize = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        setDimensions({ width, height });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    if (!nodesData.length || dimensions.width === 0) {
      return;
    }

    // Prepare data (make shallow copies for d3 simulation)
    const nodes = nodesData.map(d => ({ ...d }));
    const nodeIds = new Set(nodes.map((n) => n.id));
    const links = edgesData
      .filter((d) => nodeIds.has(d.from_node_id) && nodeIds.has(d.to_node_id))
      .map(d => ({ 
      ...d, 
      source: d.from_node_id, 
      target: d.to_node_id 
    }));

    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id).distance(150))
      .force('charge', d3.forceManyBody().strength(-800))
      .force('center', d3.forceCenter(dimensions.width / 2, dimensions.height / 2))
      .force('y', d3.forceY(dimensions.height / 2).strength(0.1))
      .force('x', d3.forceX(dimensions.width / 2).strength(0.1));

    // Definitions for arrow marker
    svg.append("defs").append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 75) // Offset to sit outside the rect
      .attr("refY", 0)
      .attr("markerWidth", 8)
      .attr("markerHeight", 8)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "var(--edge-color)");

    svg.on('click', () => {
      if (onNodeSelect) {
        onNodeSelect(null);
      }
    });

    const g = svg.append("g");

    const zoomBehavior = d3.zoom()
      .scaleExtent([0.45, 2.25])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoomBehavior);

    // Edges
    const link = g.append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr('class', d => `link ${cascadingNodeIds.includes(getNodeId(d.target)) ? 'cascading' : ''}`)
      .attr("marker-end", "url(#arrow)");

    // Nodes
    const node = g.append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr('class', d => `node-group node ${cascadingNodeIds.includes(d.id) ? 'cascading anim-ripple' : ''} ${selectedNodeId === d.id ? 'selected active glow' : ''}`)
      .call(drag(simulation))
      .on('mouseover', (event, d) => {
        const containerRect = containerRef.current?.getBoundingClientRect();
        const tooltipX = containerRect ? event.clientX - containerRect.left : event.clientX;
        const tooltipY = containerRect ? event.clientY - containerRect.top : event.clientY;

        setTooltip({
          x: tooltipX,
          y: tooltipY,
          data: d
        });
      })
      .on('click', (event, d) => {
        event.stopPropagation();
        if (onNodeSelect) {
          onNodeSelect(d);
        }
      })
      .on('mouseout', () => setTooltip(null));

    // Node Rects
    const rectWidth = 140;
    const rectHeight = 60;
    node.append("rect")
      .attr("width", rectWidth)
      .attr("height", rectHeight)
      .attr("x", -rectWidth / 2)
      .attr("y", -rectHeight / 2)
      .attr("rx", 8)
      .attr('fill', d => getNodeStatusStyle(d.status).fill)
      .attr('stroke', d => selectedNodeId === d.id ? 'var(--accent-2)' : getNodeStatusStyle(d.status).stroke)
      .attr('stroke-width', d => selectedNodeId === d.id ? 3 : 2);

    // Node Texts
    node.append("text")
      .attr("dy", -5)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--text-main)")
      .attr("font-size", "12px")
      .attr("font-weight", "600")
      .text(d => d.title.length > 22 ? `${d.title.substring(0, 22)}...` : d.title);

    node.append("text")
      .attr("dy", 15)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--text-muted)")
      .attr("font-size", "10px")
      .text(d => formatNodeTime(d.start_time));

    simulation.on("tick", () => {
      link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

      node
        .attr("transform", d => `translate(${d.x},${d.y})`);
    });

    function drag(simulation) {
      function dragstarted(event) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
      }
      function dragged(event) {
        event.subject.fx = event.x;
        event.subject.fy = event.y;
      }
      function dragended(event) {
        if (!event.active) simulation.alphaTarget(0);
        event.subject.fx = null;
        event.subject.fy = null;
      }
      return d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended);
    }

    return () => simulation.stop();

  }, [nodesData, edgesData, cascadingNodeIds, selectedNodeId, dimensions, onNodeSelect]);

  return (
    <div style={{ flex: 1, position: 'relative' }} ref={containerRef}>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ position: 'absolute', top: 0, left: 0 }}
      />
      {isLoading && (
        <div className="graph-loading">
          Loading workflow graph...
        </div>
      )}
      {!isLoading && nodesData.length === 0 && (
        <div className="graph-loading">
          No graph data yet. Seed demo data to begin.
        </div>
      )}
      {tooltip && (
        <div
          className="node-tooltip"
          style={{
            left: clamp(tooltip.x + 12, 10, Math.max(10, dimensions.width - 260)),
            top: clamp(tooltip.y + 12, 10, Math.max(10, dimensions.height - 150)),
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>{tooltip.data.title}</div>
          <div style={{ color: 'var(--text-muted)' }}>Type: {tooltip.data.node_type}</div>
          <div style={{ color: 'var(--text-muted)' }}>Status: {tooltip.data.status}</div>
          <div style={{ color: 'var(--text-muted)' }}>Start (local): {formatNodeTime(tooltip.data.start_time)}</div>
          <div style={{ color: 'var(--text-muted)' }}>End (local): {formatNodeTime(tooltip.data.end_time)}</div>
          {tooltip.data.cascade_note && (
             <div style={{ marginTop: '8px', color: 'var(--warning)', fontStyle: 'italic' }}>
               {tooltip.data.cascade_note}
             </div>
          )}
        </div>
      )}
    </div>
  );
};
