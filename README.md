# Agent Builder → ADK Converter

A web application that converts **Google Cloud Agent Builder** workflow agent exports into **Google Antigravity SDK (ADK)** Python code, with interactive DAG visualization and ADK flow mapping.

![Cloud Run](https://img.shields.io/badge/Cloud%20Run- asia--southeast3-4285F4?logo=googlecloud&logoColor=white)
![Status](https://img.shields.io/badge/status-live-1e8e3e)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)

---

## 🌐 Live Deployment

**URL:** [https://agent-builder-to-adk-27594031820.asia-southeast3.run.app](https://agent-builder-to-adk-27594031820.asia-southeast3.run.app)

- **Region:** `asia-southeast3` (Bangkok)
- **Service:** `agent-builder-to-adk`

---

## 📋 What It Does

This tool takes a JSON export from Google Cloud Agent Builder (the workflow agent definition format) and:

1. **Visualizes the workflow DAG** — renders the directed acyclic graph of nodes and edges with type-colored styling
2. **Maps to ADK architecture** — shows how each Agent Builder node type maps to Google Antigravity SDK concepts
3. **Generates ADK Python code** — produces runnable Python code using `google.antigravity` SDK patterns
4. **Provides a conversion summary** — lists every node-to-ADK mapping with warnings for missing patterns

### Supported Node Types

| Agent Builder Node Type | Visualized As | ADK Mapping |
|---|---|---|
| `CONNECTOR_EVENT_TRIGGER` | 🔵 Trigger | `on_file_change()` / custom trigger |
| `AGENT_NODE` | 🟢 Agent | `LlmAgent` with `LocalAgentConfig` |
| `CONDITION_NODE` | 🟡 Condition | `if/elif` conditional routing |
| `CONNECTOR_NODE` | 🔴 Connector | Custom Python tool function |
| `APPROVAL_NODE` | 🟣 Approval | `AskQuestionHook` / `on_interaction` |
| `AGENT_REFERENCE_NODE` | 🔗 Agent Ref | Subagent / MCP server |

---

## ✨ Features

### Zoom & Pan Visualization
- **Scroll to zoom** — mouse wheel zooms toward cursor position
- **Drag to pan** — click and drag to move the diagram
- **Zoom controls** — `+` / `−` / reset buttons in the top-right corner
- **Zoom level indicator** — shows current zoom percentage (20%–500%)

### Google Cloud Authentication
- **OAuth 2.0 sign-in** — authenticate with your Google account using Google Identity Services
- **Fetch agents from API** — list all agents across your Discovery Engine engines
- **Click to load** — click any agent in the list to fetch its full JSON and auto-convert

### Code Generation
- Generates **Pydantic schemas** for structured output (from `outputSchema` definitions)
- Creates **custom tool functions** from connector nodes (Gmail, Drive, etc.)
- Maps **event triggers** to ADK `on_file_change` / custom trigger patterns
- Produces **sequential agent orchestration** with `Agent` + `LocalAgentConfig`
- Includes **hooks** for human-in-the-loop approval nodes
- Syntax-highlighted Python output with copy/download

---

## 🚀 Running Locally

### Prerequisites
- Python 3.8+ (for the static file server)
- A modern browser (Chrome, Firefox, Safari, Edge)

### Start the dev server

```bash
cd /path/to/ge-agent-designer-to-adk/webapp
python3 -m http.server 8765
```

Open [http://localhost:8765](http://localhost:8765) in your browser.

---

## ☁️ Deploying to Cloud Run

### Prerequisites
- Google Cloud CLI (`gcloud`) installed and authenticated
- A GCP project with Cloud Run and Artifact Registry APIs enabled

### Deploy

```bash
# Set your project
gcloud config set project YOUR_PROJECT_ID

# Deploy from source
gcloud run deploy agent-builder-to-adk \
  --source . \
  --region asia-southeast3 \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --ingress all
```

The build uses the included `Dockerfile` (nginx:alpine serving static files).

### Redeploy after changes

```bash
gcloud run deploy agent-builder-to-adk \
  --source . \
  --region asia-southeast3 \
  --quiet
```

---

## 📁 Project Structure

```
ge-agent-designer-to-adk/
├── webapp/                  # Web application
│   ├── index.html           # Main HTML page (GCP Console-style UI)
│   ├── styles.css           # Dark theme design system (GCP-inspired)
│   └── converter.js         # Core logic: parser, DAG renderer, ADK code generator
├── raw_output.json          # Sample 1: SWIFT MT700 Generator (5 nodes)
├── raw_output2.json         # Sample 2: Trade Finance Flow (17 nodes, dual-path)
├── Dockerfile               # nginx:alpine container for Cloud Run
├── nginx.conf               # Nginx config (port 8080, caching, security headers)
├── .dockerignore            # Excludes non-webapp files from build context
├── .gcloudignore            # Excludes non-deploy files from gcloud upload
└── README.md                # This file
```

---

## 🧪 Sample Workflows

The app includes two built-in sample workflows for testing:

### Sample 1: SWIFT MT700 Generator (5 nodes)
A simple linear pipeline:
```
Drive File Upload → PDF Check → LLM Extraction → LLM MT700 Formatting → Email
```
- **Trigger:** Google Drive file creation in "UC3 Trade Finance" folder
- **Model:** `gemini-3.1-pro-preview`
- **Extracts:** 46 trade finance fields from LC documents
- **Output:** SWIFT MT700 message emailed to admin

### Sample 2: Trade Finance Flow (17 nodes)
A complex branching workflow with:
- Dual-path routing (SUBMIT vs APPROVE)
- Multi-document extraction (7 document types)
- Document verification gate
- MCP/ADK agent references (FX rate, fee tariff)
- Fee calculation pipeline
- Human-in-the-loop approval node
- Multiple email notification paths

---

## 🔧 How the Conversion Works

### 1. Parsing
The parser reads the Agent Builder JSON export and extracts:
- Node definitions (id, type, model, instruction, tools, output schema)
- Edge definitions (source → target with optional route labels)
- Topological layer ordering for DAG layout

### 2. DAG Visualization
Renders an SVG with:
- Layered layout (topological sort)
- Color-coded nodes by type
- Curved Bézier edge paths with route labels
- Node tooltips with full metadata

### 3. ADK Flow Mapping
Groups nodes into conceptual ADK blocks:
- Event Trigger → ADK `on_file_change` / custom trigger
- Agent Nodes → `LlmAgent` with `LocalAgentConfig`
- Condition Nodes → `if/elif` routing
- Connector Nodes → Custom tool functions
- Approval Nodes → `AskQuestionHook`
- Agent Reference Nodes → Subagent / MCP server

### 4. Code Generation
Produces Python code following ADK patterns:
- `LocalAgentConfig` for each agent with model, instructions, tools
- `pydantic.BaseModel` schemas for structured output
- Custom tool functions with docstrings
- `async def main()` with sequential `Agent()` context managers
- Variable references between agents (passing outputs as prompts)

---

## 🔐 Google Cloud Authentication Setup

To use the "Fetch Agents" feature, you need an OAuth 2.0 Client ID:

1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
2. Click **Create Credentials → OAuth client ID**
3. Choose **Web application**
4. Add your app URL to **Authorized JavaScript origins**:
   - `http://localhost:8765` (for local development)
   - `https://agent-builder-to-adk-27594031820.asia-southeast3.run.app` (for production)
5. Copy the Client ID — you'll enter it when clicking "Sign in with Google"

### Required Scopes
- `https://www.googleapis.com/auth/cloud-platform` — read access to Discovery Engine API

### API Calls Made
- `GET https://discoveryengine.googleapis.com/v1beta/projects/{project}/locations/{location}/collections/default_collection/engines` — list engines
- `GET https://discoveryengine.googleapis.com/v1beta/{engine}/assistants/default_assistant/agents` — list agents per engine
- `GET https://discoveryengine.googleapis.com/v1beta/{agent_name}` — fetch full agent JSON
- `GET https://www.googleapis.com/oauth2/v3/userinfo` — get signed-in user info

---

## 🛠️ Tech Stack

| Component | Technology |
|---|---|
| Frontend | Vanilla HTML, CSS, JavaScript (no frameworks) |
| Styling | Custom CSS design system (GCP Console-inspired dark theme) |
| Fonts | Google Sans, Roboto, Roboto Mono |
| Auth | Google Identity Services (OAuth 2.0 Token Client) |
| Container | nginx:alpine |
| Platform | Google Cloud Run |
| Region | `asia-southeast3` (Bangkok) |

---

## 📝 Notes

- The ADK code generator produces **template code** — it creates the correct structure and imports, but you'll need to fill in implementation details for tool functions and refine the orchestration logic for production use.
- The zoom/pan feature works on both the **Workflow DAG** and **ADK Flow** tabs.
- All processing happens **client-side** — no data is sent to a backend (except GCP API calls when authenticated).
