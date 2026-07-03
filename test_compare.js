const fs = require("fs");
const code = fs.readFileSync("webapp/converter.js", "utf8");

function extract(startMarker, endMarker) {
  const s = code.indexOf(startMarker);
  const e = code.indexOf(endMarker);
  return code.substring(s, e);
}

const testCode = `
${extract("function parseAgentJson", "function computeLayers")}
${extract("function computeLayers", "function renderDAG")}

${extract("function collectSchemas", "function toPascalCase")}

${extract("function toPascalCase", "function sanitizeFieldName")}
${extract("function sanitizeFieldName", "/* ============================================\n   PYTHON SYNTAX")}

${extract("function generateADKCode", "function highlightPython")}

${extract("function sanitizeFuncName", "function toPascalCase")}

const sample = fs.readFileSync("webapp/sample2.json", "utf8");
const parsed = parseAgentJson(sample);
const generatedCode = generateADKCode(parsed);
const nodeMap = parsed.nodeMap;
const agentNodes = parsed.nodes.filter(n => n.nodeType === "AGENT_NODE");

// Edge coverage with NEW logic
let edgesCovered = 0;
let edgesTotal = 0;
parsed.edges.forEach(edge => {
  edgesTotal++;
  const source = nodeMap.get(edge.source);
  const target = nodeMap.get(edge.target);
  let matched = false;
  
  if (source && target) {
    if (source.nodeType === "AGENT_NODE" && target.nodeType === "AGENT_NODE") {
      if (generatedCode.includes("Previous output:")) { edgesCovered++; matched = true; }
    }
    if (!matched && source.nodeType === "CONNECTOR_EVENT_TRIGGER" && target.nodeType === "AGENT_NODE") {
      if (generatedCode.includes("Process the triggered event data")) { edgesCovered++; matched = true; }
    }
    if (!matched && source.nodeType === "CONDITION_NODE") {
      if (generatedCode.includes('route == "' + (edge.route || "default") + '"')) { edgesCovered++; matched = true; }
    }
    if (!matched && source.nodeType === "AGENT_NODE" && target.nodeType === "CONDITION_NODE") {
      const agentIdx = agentNodes.indexOf(source);
      if (agentIdx >= 0 && generatedCode.includes("result_" + agentIdx)) { edgesCovered++; matched = true; }
    }
    if (!matched && source.nodeType === "AGENT_NODE" && target.nodeType === "CONNECTOR_NODE") {
      if (generatedCode.includes("tools=[") && generatedCode.includes(sanitizeFuncName(target.id) + "(")) { edgesCovered++; matched = true; }
    }
    if (!matched && source.nodeType === "AGENT_NODE" && target.nodeType === "APPROVAL_NODE") {
      if (generatedCode.includes("# Approval:") || generatedCode.includes("AskQuestionHook")) { edgesCovered++; matched = true; }
    }
    if (!matched && source.nodeType === "AGENT_NODE" && target.nodeType === "AGENT_REFERENCE_NODE") {
      if (generatedCode.includes("# Subagent:") || generatedCode.includes("subagent")) { edgesCovered++; matched = true; }
    }
    if (!matched && source.nodeType === "AGENT_REFERENCE_NODE" && target.nodeType === "AGENT_NODE") {
      if (generatedCode.includes("subagent.invoke")) { edgesCovered++; matched = true; }
    }
    if (!matched && source.nodeType === "APPROVAL_NODE" && target.nodeType === "CONNECTOR_NODE") {
      if (generatedCode.includes("AskQuestionHook")) { edgesCovered++; matched = true; }
    }
    if (!matched && source.nodeType === "CONDITION_NODE" && target.nodeType === "CONNECTOR_NODE") {
      if (generatedCode.includes('route == "' + (edge.route || "default") + '"')) { edgesCovered++; matched = true; }
    }
  }
  
  const status = matched ? "OK" : "MISSING";
  console.log(status + ": " + edge.source + " -> " + edge.target + " (" + (source ? source.nodeType : "?") + " -> " + (target ? target.nodeType : "?") + ")");
});

console.log("\\nEdge coverage: " + edgesCovered + "/" + edgesTotal);
`;

eval(testCode);
