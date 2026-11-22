const fs = require("fs");
const code = fs.readFileSync("webapp/converter.js", "utf8");

// Extract functions we need
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

const sample = fs.readFileSync("webapp/sample2.json", "utf8");
const parsed = parseAgentJson(sample);
const generated = generateADKCode(parsed);

fs.writeFileSync("/tmp/generated_agent.py", generated);
console.log("Written to /tmp/generated_agent.py");
console.log("Lines:", generated.split("\\n").length);

// Show schema class lines
const lines = generated.split("\\n");
let inSchema = false;
lines.forEach((line, i) => {
  if (line.includes("class ") && line.includes("Schema")) {
    inSchema = true;
  }
  if (inSchema) {
    console.log((i+1) + ": " + line);
    if (line === "" && i > 0) inSchema = false;
  }
});
`;

eval(testCode);
