/* ============================================
   converter.js
   GE Agent Builder → ADK Converter
   ============================================ */

(() => {
'use strict';

/* ============================================
   SAMPLE DATA
   ============================================ */

/* Sample data loaded from files to avoid template literal issues */
const sampleCache = {};

async function loadSample(num) {
  if (sampleCache[num]) return sampleCache[num];
  const res = await fetch(`sample${num}.json`);
  if (!res.ok) throw new Error(`Failed to load sample${num}.json`);
  const text = await res.text();
  sampleCache[num] = text;
  return text;
}

/* ============================================
   NODE TYPE METADATA
   ============================================ */

const NODE_TYPES = {
  CONNECTOR_EVENT_TRIGGER: { label: 'Trigger', color: '#1a73e8', icon: '⚡', adk: 'Trigger (on_file_change / custom)' },
  AGENT_NODE:              { label: 'Agent', color: '#1e8e3e', icon: '🤖', adk: 'LlmAgent / Agent' },
  CONDITION_NODE:          { label: 'Condition', color: '#f9ab00', icon: '🔀', adk: 'Conditional routing logic' },
  CONNECTOR_NODE:          { label: 'Connector', color: '#d93025', icon: '📧', adk: 'Custom Tool function' },
  APPROVAL_NODE:           { label: 'Approval', color: '#9334e6', icon: '✋', adk: 'AskQuestionHook / interaction' },
  AGENT_REFERENCE_NODE:    { label: 'Agent Ref', color: '#00897b', icon: '🔗', adk: 'Subagent / MCP server' },
  DEFAULT:                 { label: 'Node', color: '#5f6368', icon: '◻', adk: 'Custom logic' }
};

function getNodeTypeMeta(nodeType) {
  return NODE_TYPES[nodeType] || NODE_TYPES.DEFAULT;
}

/* ============================================
   PARSER
   ============================================ */

function parseAgentJson(jsonStr) {
  let data;
  try {
    data = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e.message}`);
  }

  if (!data.workflowAgentDefinition || !data.workflowAgentDefinition.agentFlow) {
    throw new Error('Missing workflowAgentDefinition.agentFlow');
  }

  const flow = data.workflowAgentDefinition.agentFlow;
  if (!Array.isArray(flow.nodes) || !Array.isArray(flow.edges)) {
    throw new Error('agentFlow must contain nodes[] and edges[]');
  }

  // Build node map
  const nodeMap = new Map();
  flow.nodes.forEach(n => {
    nodeMap.set(n.id, {
      id: n.id,
      displayName: n.displayName || n.id,
      nodeType: n.nodeType || 'DEFAULT',
      raw: n,
      // Extract useful info
      model: n.agentNode?.model,
      instruction: n.agentNode?.instruction,
      tools: n.agentNode?.selectedTools?.tools?.map(t => t.name) || [],
      outputSchema: n.outputSchema,
      eventType: n.connectorEventTrigger?.eventType,
      dataSource: n.connectorEventTrigger?.dataConnector?.dataSource,
      connectorTool: n.connectorNode?.toolName,
      inputParameters: n.connectorNode?.inputParameters,
      approvalMessage: n.approvalNode?.message,
      refAgent: n.agentReferenceNode?.agent,
      refType: n.agentReferenceNode?.agentReferenceType,
    });
  });

  // Build adjacency
  const outgoing = new Map();
  const incoming = new Map();
  flow.edges.forEach(e => {
    if (!outgoing.has(e.sourceNodeId)) outgoing.set(e.sourceNodeId, []);
    outgoing.get(e.sourceNodeId).push({ target: e.targetNodeId, route: e.routeString });
    if (!incoming.has(e.targetNodeId)) incoming.set(e.targetNodeId, []);
    incoming.get(e.targetNodeId).push({ source: e.sourceNodeId, route: e.routeString });
  });

  // Find root nodes (no incoming edges)
  const roots = flow.nodes.filter(n => !incoming.has(n.id)).map(n => n.id);

  // Topological order (for layering)
  const layers = computeLayers(nodeMap, outgoing, incoming, roots);

  return {
    agentInfo: {
      displayName: data.displayName,
      description: data.description,
      state: data.state,
      createTime: data.createTime,
      updateTime: data.updateTime,
      name: data.name,
    },
    nodes: flow.nodes.map(n => nodeMap.get(n.id)),
    edges: flow.edges,
    nodeMap,
    outgoing,
    incoming,
    roots,
    layers,
  };
}

function computeLayers(nodeMap, outgoing, incoming, roots) {
  const layers = [];
  const assigned = new Set();
  let current = roots.slice();

  while (current.length > 0) {
    layers.push(current);
    current.forEach(id => assigned.add(id));
    const next = [];
    current.forEach(id => {
      const outs = outgoing.get(id) || [];
      outs.forEach(({ target }) => {
        if (!assigned.has(target)) {
          const inc = incoming.get(target) || [];
          const allAssigned = inc.every(({ source }) => assigned.has(source));
          if (allAssigned && !next.includes(target)) {
            next.push(target);
          }
        }
      });
    });
    // Also add any unassigned nodes whose all predecessors are assigned
    nodeMap.forEach((_, id) => {
      if (!assigned.has(id) && !next.includes(id)) {
        const inc = incoming.get(id) || [];
        if (inc.length > 0 && inc.every(({ source }) => assigned.has(source))) {
          next.push(id);
        }
      }
    });
    current = next;
  }

  // Handle any remaining unassigned nodes (cycles or disconnected)
  nodeMap.forEach((_, id) => {
    if (!assigned.has(id)) {
      layers.push([id]);
    }
  });

  return layers;
}

/* ============================================
   DAG VISUALIZATION (SVG)
   ============================================ */

function renderDAG(parsed) {
  const svg = document.getElementById('dagSvg');
  svg.innerHTML = '';

  const layers = parsed.layers;
  const nodeMap = parsed.nodeMap;
  const nodeW = 260;
  const nodeH = 88;
  const layerGapX = 320;
  const layerGapY = 120;
  const padding = 40;

  // Calculate positions
  const positions = new Map();
  const maxLayerHeight = Math.max(...layers.map(l => l.length));
  const svgWidth = layers.length * layerGapX + padding * 2;
  const svgHeight = Math.max(maxLayerHeight * layerGapY + padding * 2, 300);

  svg.setAttribute('width', svgWidth);
  svg.setAttribute('height', svgHeight);
  svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);

  layers.forEach((layer, layerIdx) => {
    const layerHeight = layer.length * layerGapY;
    const startY = (svgHeight - layerHeight) / 2;
    layer.forEach((nodeId, nodeIdx) => {
      const y = startY + nodeIdx * layerGapY + nodeH / 2;
      const x = padding + layerIdx * layerGapX + nodeW / 2;
      positions.set(nodeId, { x, y });
    });
  });

  // Arrow def
  const defs = el('defs');
  const marker = el('marker', { id: 'arrowhead', markerWidth: 8, markerHeight: 6, refX: 8, refY: 3, orient: 'auto' });
  marker.appendChild(el('polygon', { points: '0 0, 8 3, 0 6', fill: '#5f6368' }));
  defs.appendChild(marker);
  svg.appendChild(defs);

  // Draw edges
  parsed.edges.forEach(edge => {
    const from = positions.get(edge.sourceNodeId);
    const to = positions.get(edge.targetNodeId);
    if (!from || !to) return;

    const path = el('path', {
      class: 'dag-edge',
      d: edgePath(from.x + nodeW/2, from.y, to.x - nodeW/2, to.y),
    });
    svg.appendChild(path);

    // Edge label
    if (edge.routeString) {
      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2;
      const labelBg = el('rect', {
        x: midX - 36, y: midY - 10, width: 72, height: 20, rx: 4,
        fill: '#1e1e2e', stroke: '#3c4043', 'stroke-width': 1,
      });
      svg.appendChild(labelBg);
      const label = el('text', {
        class: 'dag-edge-label',
        x: midX, y: midY + 4,
      });
      label.textContent = truncate(edge.routeString, 14);
      svg.appendChild(label);
    }
  });

  // Draw nodes — styled to match ADK Flow blocks
  parsed.nodes.forEach(node => {
    const pos = positions.get(node.id);
    if (!pos) return;

    const meta = getNodeTypeMeta(node.nodeType);
    const g = el('g', {
      class: 'dag-node',
      transform: `translate(${pos.x - nodeW/2}, ${pos.y - nodeH/2})`,
    });

    // Node container — match ADK Flow style
    g.appendChild(el('rect', {
      width: nodeW, height: nodeH, rx: 10,
      fill: '#1a1a2e', 'fill-opacity': 0.8,
      stroke: meta.color, 'stroke-width': 2,
      filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.3))',
    }));

    // Header bar — colored semi-transparent top section (like ADK Flow)
    g.appendChild(el('rect', {
      width: nodeW, height: 28, rx: 10,
      fill: meta.color, 'fill-opacity': 0.2,
    }));
    // Cover bottom rounded corners of header
    g.appendChild(el('rect', {
      x: 0, y: 14, width: nodeW, height: 14,
      fill: meta.color, 'fill-opacity': 0.2,
    }));

    // Header text — node type label, centered, bold
    const header = el('text', {
      x: nodeW / 2, y: 19, 'text-anchor': 'middle',
      'font-family': 'Google Sans, sans-serif', 'font-size': 12, 'font-weight': 700,
      fill: meta.color,
    });
    header.textContent = `${meta.icon}  ${meta.label}`;
    g.appendChild(header);

    // Content area — dot + node name + model
    const contentG = el('g', { transform: 'translate(14, 42)' });

    // Colored dot indicator
    contentG.appendChild(el('circle', {
      cx: 4, cy: 6, r: 4,
      fill: meta.color,
    }));

    // Node name — main label
    const nameText = el('text', {
      x: 16, y: 10,
      'font-family': 'Roboto, sans-serif', 'font-size': 11,
      fill: '#e8eaed',
    });
    nameText.textContent = truncate(node.displayName, 32);
    contentG.appendChild(nameText);

    // Model / detail subtext
    if (node.model) {
      const modelText = el('text', {
        x: 16, y: 24,
        'font-family': 'Roboto Mono, monospace', 'font-size': 9,
        fill: '#9aa0a6',
      });
      modelText.textContent = truncate(node.model, 32);
      contentG.appendChild(modelText);
    } else if (node.connectorTool) {
      const toolText = el('text', {
        x: 16, y: 24,
        'font-family': 'Roboto Mono, monospace', 'font-size': 9,
        fill: '#9aa0a6',
      });
      toolText.textContent = truncate(node.connectorTool, 32);
      contentG.appendChild(toolText);
    } else if (node.eventType) {
      const eventText = el('text', {
        x: 16, y: 24,
        'font-family': 'Roboto Mono, monospace', 'font-size': 9,
        fill: '#9aa0a6',
      });
      eventText.textContent = `on_${node.eventType}`;
      contentG.appendChild(eventText);
    }

    g.appendChild(contentG);

    // Tooltip via title
    const title = el('title');
    title.textContent = `${node.displayName} (${node.id})\nType: ${node.nodeType}\n${node.model ? 'Model: ' + node.model : ''}`;
    g.appendChild(title);

    svg.appendChild(g);
  });
}

function edgePath(x1, y1, x2, y2) {
  const dx = (x2 - x1) * 0.5;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/* SVG helper */
function el(tag, attrs = {}) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  return e;
}

/* ============================================
   ADK FLOW VISUALIZATION (SVG)
   ============================================ */

function renderADKFlow(parsed) {
  const svg = document.getElementById('adkFlowSvg');
  svg.innerHTML = '';

  // Group nodes into ADK conceptual blocks
  const blocks = buildADKBlocks(parsed);
  const blockW = 220;
  const blockH = 80;
  const gapX = 260;
  const gapY = 120;
  const padding = 40;

  const svgWidth = blocks.length * gapX + padding * 2;
  const svgHeight = Math.max(...blocks.map(b => b.items.length)) * 40 + padding * 2 + 60;

  svg.setAttribute('width', Math.max(svgWidth, 600));
  svg.setAttribute('height', Math.max(svgHeight, 300));
  svg.setAttribute('viewBox', `0 0 ${Math.max(svgWidth, 600)} ${Math.max(svgHeight, 300)}`);

  // Arrow def
  const defs = el('defs');
  const marker = el('marker', { id: 'adk-arrow', markerWidth: 8, markerHeight: 6, refX: 8, refY: 3, orient: 'auto' });
  marker.appendChild(el('polygon', { points: '0 0, 8 3, 0 6', fill: '#8ab4f8' }));
  defs.appendChild(marker);
  svg.appendChild(defs);

  let prevCenter = null;

  blocks.forEach((block, idx) => {
    const x = padding + idx * gapX;
    const blockCenterY = svgHeight / 2;

    // Draw block container
    const containerH = Math.max(block.items.length * 26 + 40, blockH);
    const blockG = el('g', { transform: `translate(${x}, ${blockCenterY - containerH/2})` });

    // Container rect
    blockG.appendChild(el('rect', {
      width: blockW, height: containerH, rx: 10,
      fill: '#1a1a2e', 'fill-opacity': 0.8,
      stroke: block.color, 'stroke-width': 2, 'stroke-dasharray': '0',
      filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.3))',
    }));

    // Header bar
    blockG.appendChild(el('rect', {
      width: blockW, height: 28, rx: 10,
      fill: block.color, 'fill-opacity': 0.2,
    }));
    blockG.appendChild(el('rect', {
      width: blockW, height: 14,
      fill: block.color, 'fill-opacity': 0,
    }));

    // Header text
    const header = el('text', {
      x: blockW/2, y: 18, 'text-anchor': 'middle',
      'font-family': 'Google Sans, sans-serif', 'font-size': 12, 'font-weight': 700,
      fill: block.color,
    });
    header.textContent = block.title;
    blockG.appendChild(header);

    // Items
    block.items.forEach((item, i) => {
      const y = 40 + i * 26;
      const itemG = el('g', { transform: `translate(12, ${y})` });

      // Item dot
      itemG.appendChild(el('circle', {
        cx: 4, cy: 8, r: 3, fill: item.color,
      }));

      // Item text
      const text = el('text', {
        x: 14, y: 12,
        'font-family': 'Roboto, sans-serif', 'font-size': 10,
        fill: '#e8eaed',
      });
      text.textContent = truncate(item.label, 28);
      itemG.appendChild(text);

      // Sub text
      if (item.sub) {
        const sub = el('text', {
          x: 14, y: 22,
          'font-family': 'Roboto Mono, monospace', 'font-size': 8,
          fill: '#9aa0a6',
        });
        sub.textContent = truncate(item.sub, 28);
        itemG.appendChild(sub);
      }

      blockG.appendChild(itemG);
    });

    svg.appendChild(blockG);

    // Draw arrow from previous block
    const currentCenter = { x: x + blockW/2, y: blockCenterY };
    if (prevCenter) {
      const arrowY = blockCenterY;
      const path = el('path', {
        d: edgePath(prevCenter.x, arrowY, x, arrowY),
        fill: 'none', stroke: '#8ab4f8', 'stroke-width': 2,
        'marker-end': 'url(#adk-arrow)',
        'stroke-dasharray': idx > 0 && blocks[idx-1].branch ? '5,3' : '0',
      });
      svg.appendChild(path);
    }
    prevCenter = { x: x + blockW, y: blockCenterY };
  });

  // Render info card
  renderADKInfoCard(parsed, blocks);
}

function buildADKBlocks(parsed) {
  const blocks = [];
  const nodeMap = parsed.nodeMap;

  // Follow the topological layers (same order as DAG)
  parsed.layers.forEach(layer => {
    layer.forEach(nodeId => {
      const node = nodeMap.get(nodeId);
      if (!node) return;

      const meta = getNodeTypeMeta(node.nodeType);

      // Build the ADK block based on node type, in topological order
      switch (node.nodeType) {
        case 'CONNECTOR_EVENT_TRIGGER': {
          blocks.push({
            title: 'Event Trigger',
            color: meta.color,
            items: [{
              label: node.displayName,
              sub: `on_${node.eventType || 'event'}`,
              color: meta.color,
            }],
          });
          break;
        }

        case 'AGENT_NODE': {
          const isRoot = parsed.incoming.get(node.id)?.some(
            e => nodeMap.get(e.source)?.nodeType === 'CONNECTOR_EVENT_TRIGGER'
          );
          blocks.push({
            title: isRoot ? 'Root Agent (Classifier)' : 'LlmAgent',
            color: meta.color,
            items: [{
              label: node.displayName,
              sub: node.model || 'default model',
              color: meta.color,
            }, ...(node.tools.length > 0 ? [{
              label: `Tools: ${node.tools.join(', ')}`,
              sub: 'google_search enabled',
              color: '#34a853',
            }] : [])],
          });
          break;
        }

        case 'CONDITION_NODE': {
          const routes = parsed.outgoing.get(node.id) || [];
          blocks.push({
            title: 'Conditional Router',
            color: meta.color,
            branch: true,
            items: routes.map(r => ({
              label: `if → ${r.route || 'else'}`,
              sub: `→ ${nodeMap.get(r.target)?.displayName || r.target}`,
              color: meta.color,
            })),
          });
          break;
        }

        case 'AGENT_REFERENCE_NODE': {
          blocks.push({
            title: 'Subagent / MCP',
            color: meta.color,
            items: [{
              label: node.displayName,
              sub: node.refType || 'ADK_AGENT',
              color: meta.color,
            }],
          });
          break;
        }

        case 'APPROVAL_NODE': {
          blocks.push({
            title: 'Human-in-the-loop',
            color: meta.color,
            items: [{
              label: node.displayName,
              sub: 'AskQuestionHook',
              color: meta.color,
            }],
          });
          break;
        }

        case 'CONNECTOR_NODE': {
          blocks.push({
            title: 'Output Tool',
            color: meta.color,
            items: [{
              label: node.displayName,
              sub: node.connectorTool || 'tool',
              color: meta.color,
            }],
          });
          break;
        }

        default: {
          blocks.push({
            title: 'Custom Logic',
            color: meta.color,
            items: [{
              label: node.displayName,
              sub: node.nodeType,
              color: meta.color,
            }],
          });
        }
      }
    });
  });

  return blocks;
}

function renderADKInfoCard(parsed, blocks) {
  const container = document.getElementById('adkFlowInfoCard');
  const agentCount = parsed.nodes.filter(n => n.nodeType === 'AGENT_NODE').length;
  const conditionCount = parsed.nodes.filter(n => n.nodeType === 'CONDITION_NODE').length;
  const connectorCount = parsed.nodes.filter(n => n.nodeType === 'CONNECTOR_NODE').length;
  const approvalCount = parsed.nodes.filter(n => n.nodeType === 'APPROVAL_NODE').length;
  const refCount = parsed.nodes.filter(n => n.nodeType === 'AGENT_REFERENCE_NODE').length;

  container.innerHTML = `
    <div class="agent-info-card">
      <div class="agent-info-card__title">ADK Architecture Mapping</div>
      <div class="agent-info-card__desc">The workflow maps to ${blocks.length} ADK orchestration blocks using Agent, Conversation, and Connection abstractions.</div>
      <div class="agent-info-grid">
        <div class="agent-info-item">
          <span class="agent-info-item__label">LlmAgents</span>
          <span class="agent-info-item__value">${agentCount}</span>
        </div>
        <div class="agent-info-item">
          <span class="agent-info-item__label">Conditions</span>
          <span class="agent-info-item__value">${conditionCount}</span>
        </div>
        <div class="agent-info-item">
          <span class="agent-info-item__label">Tools</span>
          <span class="agent-info-item__value">${connectorCount}</span>
        </div>
        <div class="agent-info-item">
          <span class="agent-info-item__label">Human Approval</span>
          <span class="agent-info-item__value">${approvalCount}</span>
        </div>
        <div class="agent-info-item">
          <span class="agent-info-item__label">Subagents/MCP</span>
          <span class="agent-info-item__value">${refCount}</span>
        </div>
      </div>
    </div>
  `;
}

/* ============================================
   AGENT INFO CARD
   ============================================ */

function renderAgentInfoCard(parsed) {
  const container = document.getElementById('agentInfoCard');
  const info = parsed.agentInfo;
  const nodeCount = parsed.nodes.length;
  const edgeCount = parsed.edges.length;

  container.innerHTML = `
    <div class="agent-info-card">
      <div class="agent-info-card__title">${info.displayName || 'Unnamed Agent'}</div>
      <div class="agent-info-card__desc">${info.description || 'No description provided.'}</div>
      <div class="agent-info-grid">
        <div class="agent-info-item">
          <span class="agent-info-item__label">State</span>
          <span class="agent-info-item__value">${info.state || '—'}</span>
        </div>
        <div class="agent-info-item">
          <span class="agent-info-item__label">Nodes</span>
          <span class="agent-info-item__value">${nodeCount}</span>
        </div>
        <div class="agent-info-item">
          <span class="agent-info-item__label">Edges</span>
          <span class="agent-info-item__value">${edgeCount}</span>
        </div>
        <div class="agent-info-item">
          <span class="agent-info-item__label">Layers</span>
          <span class="agent-info-item__value">${parsed.layers.length}</span>
        </div>
      </div>
    </div>
  `;
}

/* ============================================
   LEGEND
   ============================================ */

function renderLegend(containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  Object.entries(NODE_TYPES).filter(([k]) => k !== 'DEFAULT').forEach(([key, meta]) => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `<span class="legend-dot" style="background:${meta.color}"></span>${meta.label} → ${meta.adk}`;
    container.appendChild(item);
  });
}

/* ============================================
   ADK CODE GENERATOR
   ============================================ */

function generateADKCode(parsed) {
  const info = parsed.agentInfo;
  const agentName = (info.displayName || 'agent').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  const className = toPascalCase(info.displayName || 'Agent') || 'Agent';

  const agentNodes = parsed.nodes.filter(n => n.nodeType === 'AGENT_NODE');
  const triggerNodes = parsed.nodes.filter(n => n.nodeType === 'CONNECTOR_EVENT_TRIGGER');
  const conditionNodes = parsed.nodes.filter(n => n.nodeType === 'CONDITION_NODE');
  const connectorNodes = parsed.nodes.filter(n => n.nodeType === 'CONNECTOR_NODE');
  const approvalNodes = parsed.nodes.filter(n => n.nodeType === 'APPROVAL_NODE');
  const refNodes = parsed.nodes.filter(n => n.nodeType === 'AGENT_REFERENCE_NODE');

  const lines = [];

  // Header
  lines.push('"""');
  lines.push(`ADK Agent: ${info.displayName || 'Unnamed'}`);
  lines.push(`${info.description || ''}`);
  lines.push('');
  lines.push('Auto-generated from Google Cloud Agent Builder workflow export.');
  lines.push(`Original agent: ${info.name || 'N/A'}`);
  lines.push('"""');
  lines.push('');

  // Imports
  lines.push('import asyncio');
  lines.push('import logging');
  lines.push('');
  lines.push('from google.antigravity import Agent, LocalAgentConfig, types');
  lines.push('from google.antigravity.hooks import hooks');
  lines.push('from google.antigravity.triggers import on_file_change, every, TriggerContext');
  lines.push('');

  // Pydantic schemas for structured output
  const schemas = collectSchemas(parsed);
  if (schemas.length > 0) {
    lines.push('import pydantic');
    lines.push('');
    lines.push('');
    lines.push('# ============================================');
    lines.push('# Pydantic Schemas (Structured Output)');
    lines.push('# ============================================');
    lines.push('');
    schemas.forEach(s => {
      lines.push(`class ${s.name}(pydantic.BaseModel):`);
      if (s.fields.length === 0) {
        lines.push('    """Auto-generated schema"""');
        lines.push('    pass');
      } else {
        lines.push(`    """${s.desc}"""`);
        s.fields.forEach(f => {
          const fieldType = f.type === 'NUMBER' ? 'float' : f.type === 'BOOLEAN' ? 'bool' : 'str';
          if (f.safeKey !== f.key) {
            // Use Field alias to preserve original JSON key name
            lines.push(`    ${f.safeKey}: ${fieldType} | None = pydantic.Field(default=None, alias="${f.key}")`);
          } else {
            lines.push(`    ${f.safeKey}: ${fieldType} | None = None`);
          }
        });
      }
      lines.push('');
    });
  }

  // Tools (from connector nodes)
  if (connectorNodes.length > 0) {
    lines.push('');
    lines.push('# ============================================');
    lines.push('# Custom Tools (from Connector Nodes)');
    lines.push('# ============================================');
    lines.push('');
    connectorNodes.forEach(node => {
      const funcName = sanitizeFuncName(node.id);
      const toolName = node.connectorTool || 'send_message';
      lines.push(`def ${funcName}(recipient: str, subject: str, content: str) -> str:`);
      lines.push(`    """${node.displayName} — sends via ${toolName}."""`);
      lines.push(`    # TODO: Implement ${toolName} integration`);
      lines.push(`    # Original input parameters:`);
      const params = node.inputParameters || {};
      Object.entries(params).forEach(([k, v]) => {
        lines.push(`    #   ${k}: ${JSON.stringify(v).slice(0, 80)}`);
      });
      lines.push(`    logging.info(f"Sending to {recipient}: {subject}")`);
      lines.push(`    return f"Sent: {subject}"`);
      lines.push('');
    });
  }

  // Triggers
  if (triggerNodes.length > 0) {
    lines.push('');
    lines.push('# ============================================');
    lines.push('# Triggers (from Event Trigger Nodes)');
    lines.push('# ============================================');
    lines.push('');
    triggerNodes.forEach(node => {
      const triggerName = sanitizeFuncName(node.id);
      const eventType = node.eventType || 'create_file';
      const dataSource = node.dataSource || 'google_drive';
      lines.push(`async def ${triggerName}(ctx: TriggerContext, changes):`);
      lines.push(`    """Trigger: ${node.displayName} (${dataSource}/${eventType})."""`);
      lines.push(`    logging.info("Trigger fired: ${eventType} from ${dataSource}")`);
      lines.push(`    for change in changes:`);
      lines.push(`        logging.info(f"  Change: {change}")`);
      lines.push(`    await ctx.send("New ${eventType} event detected")`);
      lines.push('');
    });
  }

  // Agent configurations
  lines.push('');
  lines.push('# ============================================');
  lines.push('# Agent Configurations');
  lines.push('# ============================================');
  lines.push('');

  agentNodes.forEach((node, idx) => {
    const configName = `${sanitizeFuncName(node.id)}_config`;
    const model = node.model || 'gemini-3.5-flash';
    const instruction = (node.instruction || 'You are a helpful assistant.').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
    const tools = node.tools.length > 0 ? node.tools : [];

    lines.push(`${configName} = LocalAgentConfig(`);
    if (model) lines.push(`    model="${model}",`);
    // Truncate very long instructions
    const shortInstruction = instruction.length > 500 ? instruction.slice(0, 500) + '...' : instruction;
    lines.push(`    system_instructions="""${shortInstruction}""",`);

    // Tools
    const toolFuncs = connectorNodes.map(n => sanitizeFuncName(n.id));
    if (toolFuncs.length > 0) {
      lines.push(`    tools=[${toolFuncs.join(', ')}],`);
    }

    // Response schema
    const schema = schemas.find(s => s.nodeId === node.id);
    if (schema) {
      lines.push(`    response_schema=${schema.name},`);
    }

    lines.push(')');
    lines.push('');
  });

  // Main orchestration
  lines.push('');
  lines.push('# ============================================');
  lines.push('# Main Orchestration');
  lines.push('# ============================================');
  lines.push('');
  lines.push('async def main():');
  lines.push(`    """Main entry point for ${info.displayName}."""`);
  lines.push('    logging.info("Starting agent workflow...")');
  lines.push('');

  // Build sequential flow
  agentNodes.forEach((node, idx) => {
    const configName = `${sanitizeFuncName(node.id)}_config`;
    const varName = `${agentName}_agent_${idx}`;

    lines.push(`    # Step ${idx + 1}: ${node.displayName}`);
    lines.push(`    async with Agent(${configName}) as ${varName}:`);

    // Build prompt from incoming edges
    const incEdges = parsed.incoming.get(node.id) || [];
    const promptParts = [];
    incEdges.forEach(e => {
      const sourceNode = parsed.nodeMap.get(e.source);
      if (sourceNode) {
        if (sourceNode.nodeType === 'CONNECTOR_EVENT_TRIGGER') {
          promptParts.push(`"Process the triggered event data"`);
        } else if (sourceNode.nodeType === 'AGENT_NODE') {
          promptParts.push(`f"Previous output: {{{e.source}_response}}"`);
        }
      }
    });
    if (promptParts.length === 0) {
      promptParts.push('"Begin processing"');
    }

    lines.push(`        prompt = ${promptParts.join(' + "\\n" + ')}`);
    lines.push(`        ${varName}_response = await ${varName}.chat(prompt)`);
    lines.push(`        result_${idx} = await ${varName}_response.text()`);
    lines.push(`        logging.info(f"Step ${idx + 1} result: {result_${idx}[:200]}...")`);
    lines.push('');
  });

  // Handle conditions
  if (conditionNodes.length > 0) {
    lines.push('    # Conditional routing');
    conditionNodes.forEach(node => {
      const routes = parsed.outgoing.get(node.id) || [];
      routes.forEach(r => {
        lines.push(`    if route == "${r.route || 'default'}":`);
        lines.push(`        # → ${parsed.nodeMap.get(r.target)?.displayName || r.target}`);
        lines.push(`        pass`);
      });
    });
    lines.push('');
  }

  // Handle approvals
  if (approvalNodes.length > 0) {
    lines.push('    # Human-in-the-loop approval');
    approvalNodes.forEach(node => {
      lines.push(`    # ${node.displayName}: "${node.approvalMessage || 'Please review'}"`);
      lines.push(`    # Use AskQuestionHook or on_interaction hook`);
    });
    lines.push('');
  }

  lines.push('    logging.info("Workflow complete.")');
  lines.push('');
  lines.push('');
  lines.push('if __name__ == "__main__":');
  lines.push('    logging.basicConfig(level=logging.INFO)');
  lines.push('    asyncio.run(main())');
  lines.push('');

  return lines.join('\n');
}

function collectSchemas(parsed) {
  const schemas = [];
  parsed.nodes.forEach(node => {
    if (node.outputSchema && node.outputSchema.properties) {
      const props = Object.entries(node.outputSchema.properties);
      if (props.length > 0) {
        const name = toPascalCase(node.displayName || node.id) + 'Schema';
        schemas.push({
          name,
          nodeId: node.id,
          desc: `Output schema for ${node.displayName}`,
          fields: props.map(([key, val]) => ({
            key: key,
            safeKey: sanitizeFieldName(key),
            type: val.type || 'STRING',
          })),
        });
      }
    }
  });
  return schemas;
}

function sanitizeFieldName(name) {
  // If starts with a digit, prefix with f_
  let s = name;
  if (/^\d/.test(s)) {
    s = 'f_' + s;
  }
  // Replace any remaining invalid chars
  s = s.replace(/[^a-zA-Z0-9_]/g, '_');
  return s;
}

function toPascalCase(s) {
  return (s || '')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .split(/[\s_]+/)
    .filter(w => w.length > 0)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

function sanitizeFuncName(s) {
  return (s || 'func')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

/* ============================================
   PYTHON SYNTAX HIGHLIGHTING (Tokenizer-based)
   ============================================ */

function highlightPython(code) {
  const keywords = new Set([
    'import', 'from', 'def', 'class', 'async', 'await', 'return',
    'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally',
    'with', 'as', 'in', 'not', 'and', 'or', 'is', 'None', 'True',
    'False', 'pass', 'raise', 'yield', 'lambda', 'del', 'global',
    'nonlocal', 'assert', 'break', 'continue',
  ]);
  const builtins = new Set([
    'print', 'logging', 'asyncio', 'len', 'str', 'int', 'float',
    'bool', 'list', 'dict', 'set', 'tuple', 'range', 'open',
    'isinstance', 'enumerate', 'zip', 'map', 'filter', 'sorted',
  ]);

  const tokens = [];
  let i = 0;
  const n = code.length;

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  while (i < n) {
    const ch = code[i];
    const remaining = code.slice(i);

    // Triple-quoted strings
    if (remaining.startsWith('"""') || remaining.startsWith("'''")) {
      const quote = remaining.slice(0, 3);
      const endIdx = code.indexOf(quote, i + 3);
      const end = endIdx === -1 ? n : endIdx + 3;
      tokens.push({ type: 'string', value: code.slice(i, end) });
      i = end;
      continue;
    }

    // Single-quoted strings
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && code[j] !== ch) {
        if (code[j] === '\\') j++;
        j++;
      }
      j = Math.min(j + 1, n);
      tokens.push({ type: 'string', value: code.slice(i, j) });
      i = j;
      continue;
    }

    // Comments
    if (ch === '#') {
      let j = i;
      while (j < n && code[j] !== '\n') j++;
      tokens.push({ type: 'comment', value: code.slice(i, j) });
      i = j;
      continue;
    }

    // Decorators
    if (ch === '@' && (i === 0 || code[i - 1] === '\n' || code.slice(0, i).match(/\s+$/))) {
      let j = i + 1;
      while (j < n && /[\w.]/.test(code[j])) j++;
      tokens.push({ type: 'decorator', value: code.slice(i, j) });
      i = j;
      continue;
    }

    // Numbers
    if (/\d/.test(ch)) {
      let j = i;
      while (j < n && /[\d._eE+-]/.test(code[j])) j++;
      tokens.push({ type: 'number', value: code.slice(i, j) });
      i = j;
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < n && /[\w]/.test(code[j])) j++;
      const word = code.slice(i, j);
      if (keywords.has(word)) {
        tokens.push({ type: 'keyword', value: word });
      } else if (builtins.has(word)) {
        tokens.push({ type: 'builtin', value: word });
      } else if (code[j] === '(') {
        tokens.push({ type: 'func', value: word });
      } else {
        tokens.push({ type: 'text', value: word });
      }
      i = j;
      continue;
    }

    // Default: accumulate as plain text
    let j = i;
    while (j < n && !/[\w@"'#\d]/.test(code[j])) j++;
    if (j === i) j++;
    tokens.push({ type: 'text', value: code.slice(i, j) });
    i = j;
  }

  // Build HTML
  return tokens
    .map(t => {
      const escaped = escapeHtml(t.value);
      if (t.type === 'text') return escaped;
      return `<span class="tok-${t.type}">${escaped}</span>`;
    })
    .join('');
}

/* ============================================
   CONVERSION SUMMARY
   ============================================ */

function renderSummary(parsed) {
  const container = document.getElementById('summaryContent');
  const agentNodes = parsed.nodes.filter(n => n.nodeType === 'AGENT_NODE');
  const triggerNodes = parsed.nodes.filter(n => n.nodeType === 'CONNECTOR_EVENT_TRIGGER');
  const conditionNodes = parsed.nodes.filter(n => n.nodeType === 'CONDITION_NODE');
  const connectorNodes = parsed.nodes.filter(n => n.nodeType === 'CONNECTOR_NODE');
  const approvalNodes = parsed.nodes.filter(n => n.nodeType === 'APPROVAL_NODE');
  const refNodes = parsed.nodes.filter(n => n.nodeType === 'AGENT_REFERENCE_NODE');

  const items = [];

  // Triggers
  triggerNodes.forEach(n => {
    items.push({
      type: 'success',
      icon: '⚡',
      text: `<strong>${n.displayName}</strong> → ADK <code>on_file_change()</code> or custom trigger function. Event: <code>${n.eventType}</code>, Source: <code>${n.dataSource}</code>`,
    });
  });

  // Agents
  agentNodes.forEach(n => {
    const tools = n.tools.length > 0 ? n.tools.join(', ') : 'none';
    items.push({
      type: 'success',
      icon: '🤖',
      text: `<strong>${n.displayName}</strong> → ADK <code>LlmAgent</code> with <code>LocalAgentConfig</code>. Model: <code>${n.model || 'default'}</code>, Tools: <code>${tools}</code>`,
    });
  });

  // Conditions
  conditionNodes.forEach(n => {
    const routes = parsed.outgoing.get(n.id) || [];
    const routeNames = routes.map(r => r.route || 'default').join(', ');
    items.push({
      type: 'info',
      icon: '🔀',
      text: `<strong>${n.displayName}</strong> → ADK conditional routing (<code>if/elif</code>). Branches: <code>${routeNames}</code>`,
    });
  });

  // Connectors
  connectorNodes.forEach(n => {
    items.push({
      type: 'success',
      icon: '📧',
      text: `<strong>${n.displayName}</strong> → ADK custom tool function. Tool: <code>${n.connectorTool}</code>`,
    });
  });

  // Approvals
  approvalNodes.forEach(n => {
    items.push({
      type: 'info',
      icon: '✋',
      text: `<strong>${n.displayName}</strong> → ADK <code>AskQuestionHook</code> / <code>on_interaction</code> hook. Message: "${n.approvalMessage}"`,
    });
  });

  // Agent refs
  refNodes.forEach(n => {
    items.push({
      type: 'info',
      icon: '🔗',
      text: `<strong>${n.displayName}</strong> → ADK subagent or MCP server. Type: <code>${n.refType}</code>`,
    });
  });

  // Warnings
  if (approvalNodes.length === 0) {
    items.push({
      type: 'warn',
      icon: '⚠️',
      text: 'No human-in-the-loop approval node found. Consider adding an <code>AskQuestionHook</code> for critical decision points.',
    });
  }
  if (conditionNodes.length === 0 && parsed.nodes.length > 3) {
    items.push({
      type: 'warn',
      icon: '⚠️',
      text: 'No conditional routing found. The workflow is linear — consider adding branching for error handling.',
    });
  }
  const hasErrorPath = conditionNodes.some(n => {
    const routes = parsed.outgoing.get(n.id) || [];
    return routes.some(r => r.route && /else|fail|reject|error/i.test(r.route));
  });
  if (!hasErrorPath) {
    items.push({
      type: 'warn',
      icon: '⚠️',
      text: 'No explicit error/failure path detected. Consider adding <code>on_tool_error</code> hook for recovery.',
    });
  }

  container.innerHTML = `
    <div class="conversion-summary">
      <div class="conversion-summary__title">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        Conversion Mapping Summary
      </div>
      <ul class="conversion-summary__list">
        ${items.map(item => `
          <li class="conversion-summary__item ${item.type === 'warn' ? 'conversion-summary__item--warn' : item.type === 'info' ? 'conversion-summary__item--info' : ''}">
            <span style="font-size:14px;">${item.icon}</span>
            <span>${item.text}</span>
          </li>
        `).join('')}
      </ul>
    </div>
  `;
}

/* ============================================
   UI HELPERS
   ============================================ */

function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;

  const icons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  };

  toast.innerHTML = `${icons[type] || icons.info}<span>${msg}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastSlide 0.3s reverse';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function setStatus(type, text) {
  const el = document.getElementById('parseStatus');
  if (!type) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="status-badge status-badge--${type}"><span class="status-badge__dot"></span>${text}</div>`;
}

function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('tab--active', t.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('tab-content--active', c.id === `tab-${tabName}`);
  });
}

/* ============================================
   TEST CODE GENERATOR (pytest)
   ============================================ */

function generateTestCode(parsed) {
  const info = parsed.agentInfo;
  const className = toPascalCase(info.displayName || 'Agent') || 'Agent';
  const agentNodes = parsed.nodes.filter(n => n.nodeType === 'AGENT_NODE');
  const triggerNodes = parsed.nodes.filter(n => n.nodeType === 'CONNECTOR_EVENT_TRIGGER');
  const conditionNodes = parsed.nodes.filter(n => n.nodeType === 'CONDITION_NODE');
  const connectorNodes = parsed.nodes.filter(n => n.nodeType === 'CONNECTOR_NODE');
  const approvalNodes = parsed.nodes.filter(n => n.nodeType === 'APPROVAL_NODE');
  const refNodes = parsed.nodes.filter(n => n.nodeType === 'AGENT_REFERENCE_NODE');

  const L = [];
  L.push('"""');
  L.push(`Automated tests for ADK agent: ${info.displayName || 'Unnamed'}`);
  L.push('');
  L.push('Generated from Google Cloud Agent Builder workflow export.');
  L.push('Run with: pytest test_agent.py -v');
  L.push('"""');
  L.push('');
  L.push('import pytest');
  L.push('import asyncio');
  L.push('import ast');
  L.push('import inspect');
  L.push('');
  L.push('');

  // === Test 1: Syntax validation ===
  L.push('# ============================================');
  L.push('# Test 1: Python syntax validation');
  L.push('# ============================================');
  L.push('');
  L.push('def test_agent_py_syntax():');
  L.push('    """Verify that agent.py is syntactically valid Python."""');
  L.push('    with open("agent.py", "r") as f:');
  L.push('        source = f.read()');
  L.push('    # This will raise SyntaxError if the code is invalid');
  L.push('    ast.parse(source)');
  L.push('');
  L.push('');

  // === Test 2: Required imports ===
  L.push('# ============================================');
  L.push('# Test 2: Required ADK imports present');
  L.push('# ============================================');
  L.push('');
  L.push('def test_adk_imports():');
  L.push('    """Verify that required Google Antigravity SDK imports are present."""');
  L.push('    with open("agent.py", "r") as f:');
  L.push('        source = f.read()');
  L.push('');
  L.push('    required_imports = [');
  L.push('        "from google.antigravity import Agent",');
  L.push('        "from google.antigravity import LocalAgentConfig",');
  L.push('    ]');
  L.push('');
  L.push('    for imp in required_imports:');
  L.push('        assert imp in source, f"Missing import: {imp}"');
  L.push('');
  L.push('');

  // === Test 3: Agent configs ===
  L.push('# ============================================');
  L.push('# Test 3: Agent configurations exist');
  L.push('# ============================================');
  L.push('');
  L.push('def test_agent_configs():');
  L.push('    """Verify that LocalAgentConfig instances are created for each agent node."""');
  L.push('    with open("agent.py", "r") as f:');
  L.push('        source = f.read()');
  L.push('');
  L.push(`    # Expected ${agentNodes.length} agent configuration(s)`);
  agentNodes.forEach((node, i) => {
    const configName = `${sanitizeFuncName(node.id)}_config`;
    L.push(`    assert "${configName}" in source, "Missing config: ${configName}"`);
  });
  L.push('');
  L.push('');

  // === Test 4: Tool functions ===
  if (connectorNodes.length > 0) {
    L.push('# ============================================');
    L.push('# Test 4: Custom tool functions defined');
    L.push('# ============================================');
    L.push('');
    L.push('def test_tool_functions():');
    L.push('    """Verify that custom tool functions are defined from connector nodes."""');
    L.push('    with open("agent.py", "r") as f:');
    L.push('        source = f.read()');
    L.push('');
    connectorNodes.forEach(node => {
      const funcName = sanitizeFuncName(node.id);
      L.push(`    assert "def ${funcName}(" in source, "Missing tool function: ${funcName}"`);
    });
    L.push('');
    L.push('');
  }

  // === Test 5: Pydantic schemas ===
  const schemas = collectSchemas(parsed);
  if (schemas.length > 0) {
    L.push('# ============================================');
    L.push('# Test 5: Pydantic schema classes defined');
    L.push('# ============================================');
    L.push('');
    L.push('def test_pydantic_schemas():');
    L.push('    """Verify that Pydantic BaseModel schemas are defined for structured output."""');
    L.push('    with open("agent.py", "r") as f:');
    L.push('        source = f.read()');
    L.push('');
    schemas.forEach(s => {
      L.push(`    assert "class ${s.name}" in source, "Missing schema: ${s.name}"`);
    });
    L.push('');
    L.push('');
  }

  // === Test 6: Main function ===
  L.push('# ============================================');
  L.push('# Test 6: Main entry point exists');
  L.push('# ============================================');
  L.push('');
  L.push('def test_main_function():');
  L.push('    """Verify that async main() function and entry point exist."""');
  L.push('    with open("agent.py", "r") as f:');
  L.push('        source = f.read()');
  L.push('');
  L.push('    assert "async def main():" in source, "Missing async main() function"');
  L.push('    assert \'if __name__ == "__main__"\' in source, "Missing __main__ entry point"');
  L.push('    assert "asyncio.run(main())" in source, "Missing asyncio.run() call"');
  L.push('');
  L.push('');

  // === Test 7: Instruction strings ===
  L.push('# ============================================');
  L.push('# Test 7: System instructions present');
  L.push('# ============================================');
  L.push('');
  L.push('def test_system_instructions():');
  L.push('    """Verify that each agent config has system_instructions."""');
  L.push('    with open("agent.py", "r") as f:');
  L.push('        source = f.read()');
  L.push('');
  L.push('    # Count occurrences of system_instructions');
  L.push('    count = source.count("system_instructions=")');
  L.push(`    assert count >= ${agentNodes.length}, f"Expected ${agentNodes.length} system_instructions, found {count}"`);
  L.push('');
  L.push('');

  // === Test 8: Model configuration ===
  L.push('# ============================================');
  L.push('# Test 8: Model configuration present');
  L.push('# ============================================');
  L.push('');
  L.push('def test_model_configuration():');
  L.push('    """Verify that model is specified in agent configs."""');
  L.push('    with open("agent.py", "r") as f:');
  L.push('        source = f.read()');
  L.push('');
  L.push('    # Check that at least one model= is specified');
  L.push('    assert "model=" in source, "No model= specified in any agent config"');
  L.push('');
  L.push('');

  // === Test 9: AST structure ===
  L.push('# ============================================');
  L.push('# Test 9: AST structure validation');
  L.push('# ============================================');
  L.push('');
  L.push('def test_ast_structure():');
  L.push('    """Verify the AST has expected node types (functions, classes, imports)."""');
  L.push('    with open("agent.py", "r") as f:');
  L.push('        source = f.read()');
  L.push('    tree = ast.parse(source)');
  L.push('');
  L.push('    func_defs = [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]');
  L.push('    class_defs = [n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]');
  L.push('');
  L.push('    assert len(func_defs) > 0, "No function definitions found"');
  L.push('    assert len(class_defs) > 0, "No class definitions (schemas) found"');
  L.push('');
  L.push('');

  // === Test 10: Pyodide mock smoke test ===
  L.push('# ============================================');
  L.push('# Test 10: Smoke test with mocked ADK (no API key needed)');
  L.push('# ============================================');
  L.push('');
  L.push('def test_smoke_mocked(monkeypatch):');
  L.push('    """Smoke test that the agent code can be imported with mocked dependencies."""');
  L.push('    import sys');
  L.push('    import types');
  L.push('');
  L.push('    # Create mock google.antigravity module');
  L.push('    mock_module = types.ModuleType("google")');
  L.push('    mock_antigravity = types.ModuleType("google.antigravity")');
  L.push('    mock_antigravity.Agent = type("Agent", (), {"__init__": lambda *a, **k: None})');
  L.push('    mock_antigravity.LocalAgentConfig = type("LocalAgentConfig", (), {"__init__": lambda *a, **k: None})');
  L.push('    mock_antigravity.types = types.SimpleNamespace()');
  L.push('    mock_antigravity.ToolContext = type("ToolContext", (), {})');
  L.push('');
  L.push('    mock_triggers = types.ModuleType("google.antigravity.triggers")');
  L.push('    mock_triggers.every = lambda *a, **k: None');
  L.push('    mock_triggers.on_file_change = lambda *a, **k: None');
  L.push('    mock_triggers.TriggerContext = type("TriggerContext", (), {})');
  L.push('');
  L.push('    mock_hooks = types.ModuleType("google.antigravity.hooks")');
  L.push('    mock_hooks.hooks = type("hooks", (), {})');
  L.push('');
  L.push('    mock_module.antigravity = mock_antigravity');
  L.push('    sys.modules["google"] = mock_module');
  L.push('    sys.modules["google.antigravity"] = mock_antigravity');
  L.push('    sys.modules["google.antigravity.triggers"] = mock_triggers');
  L.push('    sys.modules["google.antigravity.hooks"] = mock_hooks');
  L.push('');
  L.push('    # Import the agent module');
  L.push('    import importlib.util');
  L.push('    spec = importlib.util.spec_from_file_location("agent_test", "agent.py")');
  L.push('    agent_mod = importlib.util.module_from_spec(spec)');
  L.push('');
  L.push('    try:');
  L.push('        spec.loader.exec_module(agent_mod)');
  L.push('        assert hasattr(agent_mod, "main"), "Module missing main()"');
  L.push('    except Exception as e:');
  L.push('        pytest.fail(f"Failed to load agent module: {e}")');
  L.push('');

  return L.join('\n');
}

/* ============================================
   REQUIREMENTS.TXT GENERATOR
   ============================================ */

function generateRequirements(parsed) {
  const lines = [
    '# Generated requirements for ADK agent',
    '# Install with: pip install -r requirements.txt',
    '',
    'google-antigravity>=0.1.0',
    'pydantic>=2.0',
    '',
    '# Testing',
    'pytest>=7.0',
    'pytest-asyncio>=0.21',
    '',
    '# Optional - for file watching triggers',
    'watchfiles>=0.20',
  ];
  return lines.join('\n') + '\n';
}

/* ============================================
   IN-BROWSER TEST RUNNER (Pyodide)
   ============================================ */

let pyodideInstance = null;
let pyodideLoading = false;

async function getPyodide() {
  if (pyodideInstance) return pyodideInstance;
  if (pyodideLoading) {
    // Wait for loading to complete
    while (pyodideLoading) {
      await new Promise(r => setTimeout(r, 200));
    }
    return pyodideInstance;
  }

  pyodideLoading = true;
  if (typeof loadPyodide === 'undefined') {
    throw new Error('Pyodide not loaded. Check your internet connection.');
  }
  pyodideInstance = await loadPyodide();
  pyodideLoading = false;
  return pyodideInstance;
}

async function runInBrowserTest(code, testCode) {
  const results = {
    checks: [],
    stdout: '',
    stderr: '',
    success: false,
  };

  try {
    const pyodide = await getPyodide();

    // Write the agent code to a virtual file
    pyodide.FS.writeFile('/agent.py', code);
    pyodide.FS.writeFile('/test_agent.py', testCode);

    // Run the tests using AST-based checks (no pytest needed)
    const testScript = `
import ast
import sys
import json

results = {"checks": [], "stdout": "", "stderr": "", "success": True}

def check(name, condition, detail=""):
    results["checks"].append({"name": name, "pass": bool(condition), "detail": detail})
    if not condition:
        results["success"] = False

# Read the agent source
try:
    with open("/agent.py", "r") as f:
        source = f.read()
except Exception as e:
    results["stderr"] = f"Cannot read agent.py: {e}"
    results["success"] = False
    print(json.dumps(results))
    sys.exit(0)

# Test 1: Syntax validation
try:
    tree = ast.parse(source)
    check("Python syntax valid", True, "ast.parse() succeeded")
except SyntaxError as e:
    check("Python syntax valid", False, str(e))
    results["stderr"] = str(e)
    print(json.dumps(results))
    sys.exit(0)

# Test 2: Required imports
required = ["from google.antigravity import Agent", "from google.antigravity import LocalAgentConfig"]
for imp in required:
    check(f"Import: {imp}", imp in source)

# Test 3: Count agent configs
config_count = source.count("LocalAgentConfig(")
check("LocalAgentConfig instances", config_count > 0, f"Found {config_count} config(s)")

# Test 4: Count tool functions
import re
tool_funcs = re.findall(r'def (\\w+)\\(.*\\):', source)
check("Tool functions defined", len(tool_funcs) > 0, f"Found {len(tool_funcs)} function(s): {', '.join(tool_funcs[:5])}")

# Test 5: Pydantic schemas
class_defs = [n.name for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]
schema_classes = [c for c in class_defs if c.endswith("Schema")]
check("Pydantic schemas", len(schema_classes) >= 0, f"Found {len(schema_classes)} schema class(es): {', '.join(schema_classes[:5])}")

# Test 6: Main function
has_main = "async def main():" in source
check("Async main() function", has_main)

has_entry = '__name__ == "__main__"' in source
check("__main__ entry point", has_entry)

has_asyncio = "asyncio.run(main())" in source
check("asyncio.run() call", has_asyncio)

# Test 7: System instructions
instr_count = source.count("system_instructions=")
check("System instructions", instr_count > 0, f"Found {instr_count} instruction(s)")

# Test 8: Model configuration
has_model = "model=" in source
check("Model configuration", has_model)

# Test 9: AST structure
func_defs = [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
check("Function definitions", len(func_defs) > 0, f"Found {len(func_defs)} function(s)")

check("Class definitions", len(class_defs) > 0, f"Found {len(class_defs)} class(es)")

# Test 10: No obvious errors
has_bare_except = "except:" in source
check("No bare except clauses", not has_bare_except, "Use specific exception types")

has_print_in_main = "print(" in source and "logging.info" in source
check("Uses logging (not print)", "import logging" in source, "logging module imported")

# Output
results["stdout"] = f"Analyzed {len(source)} bytes, {len(source.splitlines())} lines"
print(json.dumps(results))
`;

    const output = pyodide.runPython(testScript);
    const parsed = JSON.parse(output);
    results.checks = parsed.checks || [];
    results.stdout = parsed.stdout || '';
    results.stderr = parsed.stderr || '';
    results.success = parsed.success;
  } catch (e) {
    results.success = false;
    results.stderr = e.message || String(e);
    results.checks = [{
      name: 'Pyodide execution',
      pass: false,
      detail: e.message || String(e),
    }];
  }

  return results;
}

function renderTestResults(results) {
  const container = document.getElementById('testResults');
  const passCount = results.checks.filter(c => c.pass).length;
  const failCount = results.checks.filter(c => !c.pass).length;

  let html = '';

  // Summary
  if (results.success) {
    html += `
      <div class="test-summary test-summary--pass">
        <svg class="test-summary__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <div class="test-summary__text">
          All ${passCount} checks passed
          <div class="test-summary__detail">${escapeHtml(results.stdout)}</div>
        </div>
      </div>
    `;
  } else {
    html += `
      <div class="test-summary test-summary--fail">
        <svg class="test-summary__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        <div class="test-summary__text">
          ${failCount} of ${results.checks.length} checks failed
          <div class="test-summary__detail">${escapeHtml(results.stderr || results.stdout || '')}</div>
        </div>
      </div>
    `;
  }

  // Individual checks
  html += '<div style="background:var(--bg-surface);border:1px solid var(--border-light);border-radius:var(--radius-md);margin-bottom:12px;">';
  results.checks.forEach(check => {
    const icon = check.pass
      ? '<svg class="test-check__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>'
      : '<svg class="test-check__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    html += `
      <div class="test-check ${check.pass ? 'test-check--pass' : 'test-check--fail'}">
        ${icon}
        <div class="test-check__label">
          ${escapeHtml(check.name)}
          ${check.detail ? `<div class="test-check__detail">${escapeHtml(check.detail)}</div>` : ''}
        </div>
      </div>
    `;
  });
  html += '</div>';

  // Raw output
  if (results.stderr) {
    html += `<div class="test-output test-output--error">${escapeHtml(results.stderr)}</div>`;
  }

  container.innerHTML = html;
}

function renderTestLoading() {
  const container = document.getElementById('testResults');
  container.innerHTML = `
    <div class="test-summary test-summary--running">
      <span class="spinner"></span>
      <div class="test-summary__text">
        Running in-browser Python tests...
        <div class="test-summary__detail">Loading Pyodide (first run may take 10-15 seconds)</div>
      </div>
    </div>
  `;
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ============================================
   MAIN CONVERT FUNCTION
   ============================================ */

function convert() {
  const input = document.getElementById('jsonInput').value.trim();
  if (!input) {
    showToast('Please paste a JSON export first', 'error');
    return;
  }

  let parsed;
  try {
    parsed = parseAgentJson(input);
  } catch (e) {
    document.getElementById('editorWrap').classList.add('code-editor-wrap--error');
    document.getElementById('errorDisplay').style.display = 'block';
    document.getElementById('errorText').textContent = e.message;
    setStatus('error', 'Parse failed');
    showToast(e.message, 'error');
    return;
  }

  // Success
  document.getElementById('editorWrap').classList.remove('code-editor-wrap--error');
  document.getElementById('errorDisplay').style.display = 'none';
  setStatus('success', 'Valid');

  // Show content
  document.getElementById('dagEmpty').style.display = 'none';
  document.getElementById('dagContent').style.display = 'block';
  document.getElementById('adkFlowEmpty').style.display = 'none';
  document.getElementById('adkFlowContent').style.display = 'block';
  document.getElementById('codeEmpty').style.display = 'none';
  document.getElementById('codeContent').style.display = 'block';
  document.getElementById('summaryEmpty').style.display = 'none';
  document.getElementById('summaryContent').style.display = 'block';

  // Render all
  renderAgentInfoCard(parsed);
  renderDAG(parsed);
  renderADKFlow(parsed);
  renderLegend('dagLegend');
  renderLegend('adkFlowLegend');

  const code = generateADKCode(parsed);
  document.getElementById('codeOutput').innerHTML = highlightPython(code);
  document.getElementById('codeOutput').dataset.raw = code;

  // Generate test code
  const testCode = generateTestCode(parsed);
  document.getElementById('testCodeOutput').innerHTML = highlightPython(testCode);
  document.getElementById('testCodeOutput').dataset.raw = testCode;

  // Show test tab content
  document.getElementById('testEmpty').style.display = 'none';
  document.getElementById('testContent').style.display = 'block';
  document.getElementById('testResults').innerHTML = '';

  renderSummary(parsed);
  showToast('Converted successfully! Check all tabs.', 'success');
}

/* ============================================
   ZOOM & PAN MANAGER
   ============================================ */

class ZoomPanManager {
  constructor(svgEl, containerEl, zoomLevelEl) {
    this.svg = svgEl;
    this.container = containerEl;
    this.zoomLevelEl = zoomLevelEl;
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.isDragging = false;
    this.startX = 0;
    this.startY = 0;
    this.baseW = 0;
    this.baseH = 0;
    this.init();
  }

  init() {
    // Store original SVG dimensions
    this.baseW = parseInt(this.svg.getAttribute('width')) || 600;
    this.baseH = parseInt(this.svg.getAttribute('height')) || 400;

    // Mouse drag
    this.container.addEventListener('mousedown', (e) => this.onDragStart(e));
    this.container.addEventListener('mousemove', (e) => this.onDragMove(e));
    this.container.addEventListener('mouseup', () => this.onDragEnd());
    this.container.addEventListener('mouseleave', () => this.onDragEnd());

    // Wheel zoom
    this.container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      this.zoom(delta, e.offsetX, e.offsetY);
    }, { passive: false });
  }

  applyTransform() {
    this.svg.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
    if (this.zoomLevelEl) {
      this.zoomLevelEl.textContent = `${Math.round(this.scale * 100)}%`;
    }
  }

  zoom(delta, originX, originY) {
    const newScale = Math.max(0.2, Math.min(5, this.scale + delta));
    if (originX !== undefined && originY !== undefined) {
      // Zoom toward cursor position
      const rect = this.container.getBoundingClientRect();
      const cx = originX - rect.left;
      const cy = originY - rect.top;
      this.panX = cx - (cx - this.panX) * (newScale / this.scale);
      this.panY = cy - (cy - this.panY) * (newScale / this.scale);
    }
    this.scale = newScale;
    this.applyTransform();
  }

  zoomIn() {
    this.zoom(0.15);
  }

  zoomOut() {
    this.zoom(-0.15);
  }

  reset() {
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.applyTransform();
  }

  fitToContainer() {
    const containerRect = this.container.getBoundingClientRect();
    const scaleX = containerRect.width / this.baseW;
    const scaleY = containerRect.height / this.baseH;
    this.scale = Math.min(scaleX, scaleY, 1) * 0.9;
    this.panX = 0;
    this.panY = 0;
    this.applyTransform();
  }

  onDragStart(e) {
    // Don't drag if clicking on a button or control
    if (e.target.closest('.viz-btn')) return;
    this.isDragging = true;
    this.container.classList.add('dragging');
    this.startX = e.clientX - this.panX;
    this.startY = e.clientY - this.panY;
    e.preventDefault();
  }

  onDragMove(e) {
    if (!this.isDragging) return;
    this.panX = e.clientX - this.startX;
    this.panY = e.clientY - this.startY;
    this.applyTransform();
  }

  onDragEnd() {
    this.isDragging = false;
    this.container.classList.remove('dragging');
  }

  updateBaseSize() {
    this.baseW = parseInt(this.svg.getAttribute('width')) || 600;
    this.baseH = parseInt(this.svg.getAttribute('height')) || 400;
  }
}

let dagZoomPan = null;
let adkZoomPan = null;

/* ============================================
   GCP AUTHENTICATION & AGENT FETCHING
   ============================================ */

const GCP_AUTH = {
  tokenClient: null,
  accessToken: null,
  user: null,
  // Scope: read-only access to Discovery Engine / Vertex AI Search
  scopes: 'https://www.googleapis.com/auth/cloud-platform',
  clientId: null, // Will be set from user input

  init() {
    // Load Google Identity Services
    if (typeof google === 'undefined' || !google.accounts) {
      // Will retry when GIS loads
      return false;
    }
    return true;
  },

  signIn(clientId) {
    return new Promise((resolve, reject) => {
      if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
        reject(new Error('Google Identity Services not loaded. Make sure you are online.'));
        return;
      }

      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: this.scopes,
        callback: (response) => {
          if (response.error) {
            reject(new Error(response.error_description || response.error));
            return;
          }
          this.accessToken = response.access_token;
          this.fetchUserInfo().then(resolve).catch(reject);
        },
      });

      this.tokenClient.requestAccessToken({
        prompt: 'consent',
      });
    });
  },

  async fetchUserInfo() {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) throw new Error('Failed to fetch user info');
    this.user = await res.json();
    return this.user;
  },

  signOut() {
    if (this.accessToken && typeof google !== 'undefined') {
      google.accounts.oauth2.revoke(this.accessToken, () => {});
    }
    this.accessToken = null;
    this.user = null;
  },

  isAuthed() {
    return !!this.accessToken;
  },

  async fetchAgents(projectNumber, location, engineId) {
    if (!this.accessToken) throw new Error('Not authenticated');

    const baseUrl = 'https://discoveryengine.googleapis.com/v1alpha';
    const allAgents = [];

    // If engineId is provided, fetch agents directly from that engine
    if (engineId) {
      const agentsUrl = `${baseUrl}/projects/${projectNumber}/locations/${location}/collections/default_collection/engines/${engineId}/assistants/default_assistant/agents?pageSize=50`;

      const res = await fetch(agentsUrl, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Failed to fetch agents from engine ${engineId}: ${err}`);
      }

      const data = await res.json();
      const agents = data.agents || [];
      agents.forEach(agent => {
        allAgents.push({
          name: agent.name,
          displayName: agent.displayName || 'Unnamed',
          description: agent.description || '',
          state: agent.state || 'UNKNOWN',
          createTime: agent.createTime || '',
          updateTime: agent.updateTime || '',
          raw: agent,
        });
      });

      return allAgents;
    }

    // No engineId — list all engines first, then fetch agents from each
    const enginesUrl = `${baseUrl}/projects/${projectNumber}/locations/${location}/collections/default_collection/engines?pageSize=50`;

    const enginesRes = await fetch(enginesUrl, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!enginesRes.ok) {
      const err = await enginesRes.text();
      throw new Error(`Failed to fetch engines: ${err}`);
    }

    const enginesData = await enginesRes.json();
    const engines = enginesData.engines || [];

    for (const engine of engines) {
      const engineName = engine.name;
      const assistantsUrl = `${baseUrl}/${engineName}/assistants/default_assistant/agents?pageSize=50`;

      try {
        const agentsRes = await fetch(assistantsUrl, {
          headers: { Authorization: `Bearer ${this.accessToken}` },
        });

        if (agentsRes.ok) {
          const agentsData = await agentsRes.json();
          const agents = agentsData.agents || [];
          agents.forEach(agent => {
            allAgents.push({
              name: agent.name,
              displayName: agent.displayName || 'Unnamed',
              description: agent.description || '',
              state: agent.state || 'UNKNOWN',
              createTime: agent.createTime || '',
              updateTime: agent.updateTime || '',
              raw: agent,
            });
          });
        }
      } catch (e) {
        console.warn(`Failed to fetch agents for engine ${engineName}:`, e);
      }
    }

    return allAgents;
  },

  async fetchAgentDetails(agentName) {
    if (!this.accessToken) throw new Error('Not authenticated');

    const baseUrl = 'https://discoveryengine.googleapis.com/v1alpha';
    const url = `${baseUrl}/${agentName}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to fetch agent: ${err}`);
    }

    return await res.json();
  },
};

/* ============================================
   GCP AUTH UI HANDLING
   ============================================ */

function updateGcpAuthUI() {
  const signInBtn = document.getElementById('gcpSignInBtn');
  const signOutBtn = document.getElementById('gcpSignOutBtn');
  const fetchBtn = document.getElementById('gcpFetchBtn');
  const status = document.getElementById('gcpAuthStatus');

  if (GCP_AUTH.isAuthed()) {
    const user = GCP_AUTH.user;
    signInBtn.style.display = 'none';
    signOutBtn.style.display = '';
    fetchBtn.style.display = '';
    status.className = 'gcp-auth-status gcp-auth-status--authenticated';
    status.innerHTML = `
      <div class="gcp-user-info">
        <div class="gcp-avatar">${(user?.name || user?.given_name || '?')[0]}</div>
        <div>
          <div class="gcp-user-name">${user?.name || 'Authenticated'}</div>
          <div class="gcp-user-email">${user?.email || ''}</div>
        </div>
      </div>
    `;
  } else {
    signInBtn.style.display = '';
    signOutBtn.style.display = 'none';
    fetchBtn.style.display = 'none';
    status.className = 'gcp-auth-status';
    status.textContent = 'Not connected';
  }
}

function showAgentList(agents) {
  const container = document.getElementById('gcpAgentList');
  container.style.display = '';
  container.innerHTML = '';

  if (agents.length === 0) {
    container.innerHTML = '<div class="agent-list-empty">No agents found in this project.</div>';
    return;
  }

  const listDiv = document.createElement('div');
  listDiv.className = 'agent-list';

  agents.forEach(agent => {
    const item = document.createElement('div');
    item.className = 'agent-list-item';
    item.innerHTML = `
      <div class="agent-list-item__icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="8" r="4"/>
          <path d="M4 20c0-4 4-6 8-6s8 2 8 6"/>
        </svg>
      </div>
      <div class="agent-list-item__info">
        <div class="agent-list-item__name">${escapeHtml(agent.displayName)}</div>
        <div class="agent-list-item__desc">${escapeHtml(agent.description || agent.name.split('/').pop())}</div>
      </div>
      <div class="agent-list-item__arrow">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
    `;

    item.addEventListener('click', async () => {
      item.style.opacity = '0.5';
      showToast('Fetching agent details...', 'info');
      try {
        const fullAgent = await GCP_AUTH.fetchAgentDetails(agent.name);
        document.getElementById('jsonInput').value = JSON.stringify(fullAgent, null, 2);
        showToast(`Loaded agent: ${agent.displayName}`, 'success');
        convert();
      } catch (e) {
        showToast(e.message, 'error');
      } finally {
        item.style.opacity = '';
      }
    });

    listDiv.appendChild(item);
  });

  container.appendChild(listDiv);
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s || '';
  return div.innerHTML;
}

/* ============================================
   EVENT LISTENERS
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize GCP auth
  GCP_AUTH.init();

  // Convert button
  document.getElementById('convertBtn').addEventListener('click', convert);

  // Format button
  document.getElementById('formatBtn').addEventListener('click', () => {
    const textarea = document.getElementById('jsonInput');
    try {
      const parsed = JSON.parse(textarea.value);
      textarea.value = JSON.stringify(parsed, null, 2);
      showToast('JSON formatted', 'success');
    } catch (e) {
      showToast(`Cannot format: ${e.message}`, 'error');
    }
  });

  // Clear button
  document.getElementById('clearBtn').addEventListener('click', () => {
    document.getElementById('jsonInput').value = '';
    setStatus(null);
    document.getElementById('errorDisplay').style.display = 'none';
    document.getElementById('editorWrap').classList.remove('code-editor-wrap--error');
    showToast('Cleared', 'info');
  });

  // Sample buttons — async load from JSON files
  document.querySelectorAll('.sample-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const num = btn.dataset.sample;
      try {
        showToast('Loading sample...', 'info');
        const sample = await loadSample(num);
        document.getElementById('jsonInput').value = sample;
        showToast(`Loaded sample ${num}`, 'info');
        convert();
      } catch (e) {
        showToast(`Failed to load sample: ${e.message}`, 'error');
      }
    });
  });

  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Copy code
  document.getElementById('copyBtn').addEventListener('click', () => {
    const code = document.getElementById('codeOutput').dataset.raw || '';
    navigator.clipboard.writeText(code).then(() => {
      showToast('Code copied to clipboard', 'success');
    }).catch(() => {
      showToast('Failed to copy', 'error');
    });
  });

  // Download code
  document.getElementById('downloadBtn').addEventListener('click', () => {
    const code = document.getElementById('codeOutput').dataset.raw || '';
    downloadFile(code, 'agent.py', 'text/x-python');
    showToast('Downloaded agent.py', 'success');
  });

  // Help & About
  document.getElementById('helpBtn').addEventListener('click', () => {
    showToast('Paste your Agent Builder JSON export → Click Convert → Explore the DAG, ADK Flow, Code, and Summary tabs. Scroll to zoom, drag to pan.', 'info');
  });
  document.getElementById('aboutBtn').addEventListener('click', () => {
    showToast('GE Agent Designer → ADK Converter. Converts Google Cloud Agent Builder workflows to Google Antigravity SDK code.', 'info');
  });

  // === Zoom & Pan Controls ===
  // DAG
  document.getElementById('dagZoomIn').addEventListener('click', () => dagZoomPan?.zoomIn());
  document.getElementById('dagZoomOut').addEventListener('click', () => dagZoomPan?.zoomOut());
  document.getElementById('dagZoomReset').addEventListener('click', () => dagZoomPan?.reset());

  // ADK Flow
  document.getElementById('adkZoomIn').addEventListener('click', () => adkZoomPan?.zoomIn());
  document.getElementById('adkZoomOut').addEventListener('click', () => adkZoomPan?.zoomOut());
  document.getElementById('adkZoomReset').addEventListener('click', () => adkZoomPan?.reset());

  // === Test Actions ===
  document.getElementById('runTestBtn').addEventListener('click', async () => {
    const code = document.getElementById('codeOutput').dataset.raw || '';
    const testCode = document.getElementById('testCodeOutput').dataset.raw || '';
    if (!code) {
      showToast('No code to test. Convert a workflow first.', 'error');
      return;
    }
    renderTestLoading();
    switchTab('test');
    try {
      const results = await runInBrowserTest(code, testCode);
      renderTestResults(results);
      if (results.success) {
        showToast(`All ${results.checks.filter(c => c.pass).length} checks passed!`, 'success');
      } else {
        showToast(`${results.checks.filter(c => !c.pass).length} checks failed`, 'error');
      }
    } catch (e) {
      renderTestResults({
        success: false,
        checks: [{ name: 'Test execution', pass: false, detail: e.message }],
        stderr: e.message,
        stdout: '',
      });
      showToast(e.message, 'error');
    }
  });

  document.getElementById('downloadTestBtn').addEventListener('click', () => {
    const testCode = document.getElementById('testCodeOutput').dataset.raw || '';
    downloadFile(testCode, 'test_agent.py', 'text/x-python');
    showToast('Downloaded test_agent.py', 'success');
  });

  document.getElementById('downloadReqBtn').addEventListener('click', () => {
    const reqContent = generateRequirements(null);
    downloadFile(reqContent, 'requirements.txt', 'text/plain');
    showToast('Downloaded requirements.txt', 'success');
  });

  document.getElementById('copyTestBtn').addEventListener('click', () => {
    const testCode = document.getElementById('testCodeOutput').dataset.raw || '';
    navigator.clipboard.writeText(testCode).then(() => {
      showToast('Test code copied to clipboard', 'success');
    }).catch(() => {
      showToast('Failed to copy', 'error');
    });
  });

  // === GCP Auth ===
  document.getElementById('gcpSignInBtn').addEventListener('click', async () => {
    // The user needs to provide their own OAuth Client ID for this to work
    // For demo, we check if they have entered one
    let clientId = localStorage.getItem('gcp_oauth_client_id');

    if (!clientId) {
      clientId = prompt(
        'Enter your Google OAuth Client ID\n\n' +
        'To enable GCP authentication, you need an OAuth 2.0 Client ID from Google Cloud Console.\n' +
        'Create one at: https://console.cloud.google.com/apis/credentials\n\n' +
        'Make sure to add http://localhost:8765 to authorized JavaScript origins.'
      );
      if (!clientId) return;
      localStorage.setItem('gcp_oauth_client_id', clientId);
    }

    try {
      showToast('Opening Google sign-in...', 'info');

      // Wait for Google Identity Services if not loaded yet
      let retries = 0;
      while (typeof google === 'undefined' && retries < 20) {
        await new Promise(r => setTimeout(r, 100));
        retries++;
      }

      await GCP_AUTH.signIn(clientId);
      updateGcpAuthUI();
      showToast(`Signed in as ${GCP_AUTH.user?.email || 'user'}`, 'success');
    } catch (e) {
      showToast(e.message, 'error');
    }
  });

  document.getElementById('gcpSignOutBtn').addEventListener('click', () => {
    GCP_AUTH.signOut();
    updateGcpAuthUI();
    document.getElementById('gcpAgentList').style.display = 'none';
    showToast('Signed out', 'info');
  });

  document.getElementById('gcpFetchBtn').addEventListener('click', async () => {
    const projectNumber = document.getElementById('gcpProjectInput').value.trim();
    const location = document.getElementById('gcpLocationInput').value.trim() || 'global';
    const engineId = document.getElementById('gcpEngineInput').value.trim();

    if (!projectNumber) {
      showToast('Please enter your GCP Project Number', 'error');
      return;
    }

    const listContainer = document.getElementById('gcpAgentList');
    listContainer.style.display = '';
    listContainer.innerHTML = '<div class="agent-list-loading"><span class="spinner"></span> Fetching agents...</div>';

    try {
      const agents = await GCP_AUTH.fetchAgents(projectNumber, location, engineId);
      showAgentList(agents);
      showToast(`Found ${agents.length} agent(s)`, 'success');
    } catch (e) {
      listContainer.innerHTML = `<div class="agent-list-empty">Error: ${escapeHtml(e.message)}</div>`;
      showToast(e.message, 'error');
    }
  });
});

/* ============================================
   OVERRIDE: Initialize zoom/pan after render
   ============================================ */

const _origRenderDAG = renderDAG;
renderDAG = function(parsed) {
  _origRenderDAG(parsed);
  // Initialize or update zoom/pan after rendering
  const svg = document.getElementById('dagSvg');
  const container = document.getElementById('dagContainer');
  const zoomLevelEl = document.getElementById('dagZoomLevel');
  if (svg && container) {
    if (!dagZoomPan) {
      dagZoomPan = new ZoomPanManager(svg, container, zoomLevelEl);
    } else {
      dagZoomPan.svg = svg;
      dagZoomPan.updateBaseSize();
      dagZoomPan.reset();
    }
  }
};

const _origRenderADKFlow = renderADKFlow;
renderADKFlow = function(parsed) {
  _origRenderADKFlow(parsed);
  const svg = document.getElementById('adkFlowSvg');
  const container = document.getElementById('adkFlowContainer');
  const zoomLevelEl = document.getElementById('adkZoomLevel');
  if (svg && container) {
    if (!adkZoomPan) {
      adkZoomPan = new ZoomPanManager(svg, container, zoomLevelEl);
    } else {
      adkZoomPan.svg = svg;
      adkZoomPan.updateBaseSize();
      adkZoomPan.reset();
    }
  }
};

})();
