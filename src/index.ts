import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { listOrgs } from './auth.js';
import {
  soqlQuery, getRecord, createRecord, updateRecord, deleteRecord,
  executeApex, listSObjects, describeSObject, schemaForQuery,
  listFlows, listFlexiPages, getMetadata, deployMetadata,
} from './api.js';

const server = new Server(
  { name: 'salesforce-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

// ─── Tool definitions ─────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_orgs',
      description: 'List all authenticated Salesforce orgs known to SF CLI',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'soql_query',
      description: 'Run a SOQL query. Supports all SOQL syntax including subqueries, aggregates, and relationship queries.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'SOQL query string' },
          org_alias: { type: 'string', description: 'SF CLI org alias (uses default org if omitted)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_record',
      description: 'Retrieve a single Salesforce record by ID',
      inputSchema: {
        type: 'object',
        properties: {
          object_type: { type: 'string', description: 'SObject API name (e.g. Account, Opportunity__c)' },
          id: { type: 'string', description: '15 or 18 character Salesforce record ID' },
          fields: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific fields to return — omit for all fields',
          },
          org_alias: { type: 'string' },
        },
        required: ['object_type', 'id'],
      },
    },
    {
      name: 'create_record',
      description: 'Create a new Salesforce record',
      inputSchema: {
        type: 'object',
        properties: {
          object_type: { type: 'string', description: 'SObject API name' },
          fields: { type: 'object', description: 'Field API names and values to set' },
          org_alias: { type: 'string' },
        },
        required: ['object_type', 'fields'],
      },
    },
    {
      name: 'update_record',
      description: 'Update an existing Salesforce record. Only include fields to change.',
      inputSchema: {
        type: 'object',
        properties: {
          object_type: { type: 'string' },
          id: { type: 'string' },
          fields: { type: 'object', description: 'Field API names and updated values' },
          org_alias: { type: 'string' },
        },
        required: ['object_type', 'id', 'fields'],
      },
    },
    {
      name: 'delete_record',
      description: 'Delete a Salesforce record by ID',
      inputSchema: {
        type: 'object',
        properties: {
          object_type: { type: 'string' },
          id: { type: 'string' },
          org_alias: { type: 'string' },
        },
        required: ['object_type', 'id'],
      },
    },
    {
      name: 'execute_apex',
      description: 'Execute anonymous Apex code via the Tooling API. Returns compile/run status and debug logs.',
      inputSchema: {
        type: 'object',
        properties: {
          apex_code: { type: 'string', description: 'Apex code to execute anonymously' },
          org_alias: { type: 'string' },
        },
        required: ['apex_code'],
      },
    },
    {
      name: 'list_sobjects',
      description: 'List all SObjects available in the org (name, label, queryable, etc.)',
      inputSchema: {
        type: 'object',
        properties: {
          org_alias: { type: 'string' },
        },
      },
    },
    {
      name: 'describe_sobject',
      description: 'Describe an SObject — returns fields, data types, picklist values, relationships, and record types.',
      inputSchema: {
        type: 'object',
        properties: {
          object_name: { type: 'string', description: 'SObject API name' },
          org_alias: { type: 'string' },
        },
        required: ['object_name'],
      },
    },
    {
      name: 'schema_for_query',
      description: [
        'Fetch a compact field reference for one or more SObjects — API names, labels, types,',
        'picklist values, and relationship names. Use this before writing SOQL from a natural',
        'language request to ensure field API names are correct, especially for custom fields.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          object_names: {
            type: 'array',
            items: { type: 'string' },
            description: 'One or more SObject API names to describe (e.g. ["Account", "Opportunity"])',
          },
          org_alias: { type: 'string' },
        },
        required: ['object_names'],
      },
    },
    {
      name: 'list_flows',
      description: 'List all Flows in the org with their type, status, and active version',
      inputSchema: {
        type: 'object',
        properties: {
          org_alias: { type: 'string' },
        },
      },
    },
    {
      name: 'list_flexipages',
      description: 'List all Lightning App Builder pages (FlexiPages) in the org',
      inputSchema: {
        type: 'object',
        properties: {
          org_alias: { type: 'string' },
        },
      },
    },
    {
      name: 'get_metadata',
      description: [
        'Retrieve metadata XML for any metadata type — Flow, FlexiPage (Dynamic Forms / Lightning pages),',
        'Layout, ApexClass, PermissionSet, Profile, and more.',
        'Use full_name = the component API name (e.g. "My_Flow", "Account-Account Layout").',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          metadata_type: {
            type: 'string',
            description: 'Metadata type API name (e.g. Flow, FlexiPage, Layout, ApexClass, PermissionSet)',
          },
          full_name: { type: 'string', description: 'Component API name / full name' },
          org_alias: { type: 'string' },
        },
        required: ['metadata_type', 'full_name'],
      },
    },
    {
      name: 'deploy_metadata',
      description: [
        'Deploy metadata XML back to the org. Use after get_metadata + modifications.',
        'Covers Flows (build/edit), FlexiPages (Dynamic Forms, component layout),',
        'Layouts, PermissionSets, and any other source-trackable metadata type.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          metadata_type: {
            type: 'string',
            description: 'Metadata type API name (e.g. Flow, FlexiPage, Layout)',
          },
          full_name: { type: 'string', description: 'Component API name — must match xml_content' },
          xml_content: { type: 'string', description: 'Complete metadata XML to deploy' },
          org_alias: { type: 'string' },
        },
        required: ['metadata_type', 'full_name', 'xml_content'],
      },
    },
  ],
}));

// ─── Tool handlers ────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    let result: unknown;

    switch (name) {
      case 'list_orgs':
        result = listOrgs();
        break;

      case 'soql_query':
        result = await soqlQuery(
          args.query as string,
          args.org_alias as string | undefined,
        );
        break;

      case 'get_record':
        result = await getRecord(
          args.object_type as string,
          args.id as string,
          args.fields as string[] | undefined,
          args.org_alias as string | undefined,
        );
        break;

      case 'create_record':
        result = await createRecord(
          args.object_type as string,
          args.fields as Record<string, unknown>,
          args.org_alias as string | undefined,
        );
        break;

      case 'update_record':
        result = await updateRecord(
          args.object_type as string,
          args.id as string,
          args.fields as Record<string, unknown>,
          args.org_alias as string | undefined,
        );
        break;

      case 'delete_record':
        result = await deleteRecord(
          args.object_type as string,
          args.id as string,
          args.org_alias as string | undefined,
        );
        break;

      case 'execute_apex':
        result = await executeApex(
          args.apex_code as string,
          args.org_alias as string | undefined,
        );
        break;

      case 'list_sobjects':
        result = await listSObjects(args.org_alias as string | undefined);
        break;

      case 'schema_for_query':
        result = await schemaForQuery(
          args.object_names as string[],
          args.org_alias as string | undefined,
        );
        break;

      case 'describe_sobject':
        result = await describeSObject(
          args.object_name as string,
          args.org_alias as string | undefined,
        );
        break;

      case 'list_flows':
        result = await listFlows(args.org_alias as string | undefined);
        break;

      case 'list_flexipages':
        result = await listFlexiPages(args.org_alias as string | undefined);
        break;

      case 'get_metadata':
        result = getMetadata(
          args.metadata_type as string,
          args.full_name as string,
          args.org_alias as string | undefined,
        );
        break;

      case 'deploy_metadata':
        result = deployMetadata(
          args.metadata_type as string,
          args.full_name as string,
          args.xml_content as string,
          args.org_alias as string | undefined,
        );
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{
        type: 'text',
        text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
      }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
