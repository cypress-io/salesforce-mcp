# salesforce-mcp

A Model Context Protocol (MCP) server that gives Claude direct access to your Salesforce orgs — SOQL queries, record CRUD, anonymous Apex, object metadata, Flows, and FlexiPages (Dynamic Forms).

Authentication reuses your existing SF CLI sessions — no credentials stored in config files.

---

## Prerequisites

- **Node.js 18+**
- **SF CLI v2** — [install guide](https://developer.salesforce.com/tools/salesforcecli)
- At least one org authenticated: `sf org login web --alias myorg`
- **Claude Desktop** (Mac or Windows)

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/kenny-buckles/salesforce-mcp.git
cd salesforce-mcp
npm install
npm run build
```

### 2. Configure Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "salesforce": {
      "command": "node",
      "args": ["/absolute/path/to/salesforce-mcp/dist/index.js"]
    }
  }
}
```

Replace `/absolute/path/to/salesforce-mcp` with the actual path where you cloned the repo.

### 3. Restart Claude Desktop

The Salesforce tools will appear in the MCP tools panel.

---

## Available Tools

All tools accept an optional `org_alias` parameter. If omitted, the SF CLI default org is used.

### Org

| Tool | Description |
|------|-------------|
| `list_orgs` | List all authenticated orgs known to SF CLI |

### Data (REST API)

| Tool | Description |
|------|-------------|
| `soql_query` | Run any SOQL query — supports subqueries, aggregates, relationships |
| `get_record` | Fetch a single record by ID, optionally specifying fields |
| `create_record` | Create a new record |
| `update_record` | Update an existing record (only changed fields needed) |
| `delete_record` | Delete a record by ID |

### Apex

| Tool | Description |
|------|-------------|
| `execute_apex` | Execute anonymous Apex via the Tooling API — returns compile/run status |

### Schema & Metadata

| Tool | Description |
|------|-------------|
| `list_sobjects` | List all SObjects available in the org |
| `describe_sobject` | Describe an SObject — fields, data types, picklist values, relationships |
| `list_flows` | List all Flows with type, status, and active version |
| `list_flexipages` | List all Lightning App Builder pages (FlexiPages) |
| `get_metadata` | Retrieve metadata XML for any type: Flow, FlexiPage, Layout, ApexClass, PermissionSet, etc. |
| `deploy_metadata` | Deploy modified metadata XML back to the org |

---

## Usage Examples

### Query records

```
Run a SOQL query to find all Accounts created this year with AnnualRevenue > 1M
```

### Build or modify a Flow

```
Get the metadata for the Flow called "Lead_Assignment" and add a decision element
that routes to a different path if the Lead source is "Web"
```

### Adjust Dynamic Forms on a Lightning Page

```
Get the FlexiPage metadata for "Account_Record_Page", then move the Phone and
Email fields into a new "Contact Info" section at the top of the page
```

### Execute Apex

```
Execute anonymous Apex to update the Status field to "Active" on all Contacts
where the parent Account is in the "Technology" industry
```

### Describe an object

```
Describe the Opportunity object and show me all fields related to amount and close date
```

---

## Multi-org Usage

Specify `org_alias` on any tool call to target a specific org:

```
Run a SOQL query against my "prod" org alias to count open cases by priority
```

---

## Development

```bash
# Run directly with tsx (no build step needed)
npm run dev

# Rebuild after changes
npm run build
```

To point Claude Desktop at the dev server instead of the compiled build:

```json
{
  "mcpServers": {
    "salesforce": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/salesforce-mcp/src/index.ts"]
    }
  }
}
```

---

## Architecture

```
src/
├── index.ts   — MCP server, tool definitions, request routing
├── auth.ts    — SF CLI auth (runs `sf org display --json` to get tokens)
└── api.ts     — Salesforce operations (REST API for data, SF CLI for metadata)
```

**Metadata operations** (`get_metadata` / `deploy_metadata`) use `sf project retrieve start` and `sf project deploy start` under the hood, creating a temporary project directory per operation and cleaning it up afterward.

**Data operations** hit the Salesforce REST API directly using the access token from SF CLI.

Supported metadata types with known folder/extension mappings:

| Type | Folder | Extension |
|------|--------|-----------|
| Flow | flows | .flow-meta.xml |
| FlexiPage | flexipages | .flexipage-meta.xml |
| Layout | layouts | .layout-meta.xml |
| ApexClass | classes | .cls-meta.xml |
| ApexTrigger | triggers | .trigger-meta.xml |
| CustomObject | objects | .object-meta.xml |
| PermissionSet | permissionsets | .permissionset-meta.xml |
| Profile | profiles | .profile-meta.xml |
| LightningComponentBundle | lwc | .js-meta.xml |
| StaticResource | staticresources | .resource-meta.xml |

Any other metadata type falls back to `{type.toLowerCase()}s` / `{type.toLowerCase()}-meta.xml`.

---

## License

MIT
