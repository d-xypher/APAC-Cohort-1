import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

export const DAGGraph = ({ nodesData, edgesData, cascadingNodeIds }) => {
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
    if (!nodesData.length || dimensions.width === 0) return;

    // Prepare data (make shallow copies for d3 simulation)
    const nodes = nodesData.map(d => ({ ...d }));
    const links = edgesData.map(d => ({ 
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

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

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
      .attr("fill", "var(--glass-border)");

    const g = svg.append("g");

    // Edges
    const link = g.append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("class", d => `link ${cascadingNodeIds.includes(d.target.id) ? 'cascading' : ''}`)
      .attr("marker-end", "url(#arrow)");

    // Nodes
    const node = g.append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("class", d => `node-group ${cascadingNodeIds.includes(d.id) ? 'cascading anim-ripple' : ''}`)
      .call(drag(simulation))
      .on('mouseover', (event, d) => {
        setTooltip({
          x: event.clientX,
          y: event.clientY,
          data: d
        });
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
      .attr("fill", "var(--bg-card)")
      .attr("stroke", "var(--glass-border)")
      .attr("stroke-width", 2);

    // Node Texts
    node.append("text")
      .attr("dy", -5)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--text-main)")
      .attr("font-size", "12px")
      .attr("font-weight", "600")
      .text(d => d.title.length > 20 ? d.title.substring(0,20)+'...' : d.title);

    node.append("text")
      .attr("dy", 15)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--text-muted)")
      .attr("font-size", "10px")
      .text(d => {
        if (!d.start_time) return "Unscheduled";
        const time = new Date(d.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return time;
      });

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

  }, [nodesData, edgesData, cascadingNodeIds, dimensions]);

  return (
    <div style={{ flex: 1, position: 'relative' }} ref={containerRef}>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ position: 'absolute', top: 0, left: 0 }}
      />
      {tooltip && (
        <div className="node-tooltip" style={{ left: tooltip.x + 15, top: tooltip.y + 15 }}>
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>{tooltip.data.title}</div>
          <div style={{ color: 'var(--text-muted)' }}>Type: {tooltip.data.node_type}</div>
          <div style={{ color: 'var(--text-muted)' }}>Status: {tooltip.data.status}</div>
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
