import { execSync } from 'child_process';
import {
  mkdtempSync, writeFileSync, rmSync,
  readFileSync, mkdirSync, readdirSync, statSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getOrgAuth, redactSecretsFromCliText } from './auth.js';

const API_VERSION = 'v62.0';

// ─── REST helper ─────────────────────────────────────────────────────────────

async function sfFetch(
  accessToken: string,
  instanceUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const res = await fetch(`${instanceUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();

  if (!res.ok) {
    let msg = text;
    try {
      const errs = JSON.parse(text);
      if (Array.isArray(errs)) msg = errs.map((e: any) => e.message).join('; ');
    } catch {}
    throw new Error(`SF ${method} ${path} → ${res.status}: ${msg}`);
  }

  return text.length > 0 ? JSON.parse(text) : null;
}

// ─── Data operations ──────────────────────────────────────────────────────────

export async function soqlQuery(query: string, alias?: string) {
  const { accessToken, instanceUrl } = getOrgAuth(alias);
  return sfFetch(accessToken, instanceUrl, 'GET',
    `/services/data/${API_VERSION}/query?q=${encodeURIComponent(query)}`);
}

export async function getRecord(objectType: string, id: string, fields?: string[], alias?: string) {
  const { accessToken, instanceUrl } = getOrgAuth(alias);
  const qs = fields?.length ? `?fields=${fields.join(',')}` : '';
  return sfFetch(accessToken, instanceUrl, 'GET',
    `/services/data/${API_VERSION}/sobjects/${objectType}/${id}${qs}`);
}

export async function createRecord(
  objectType: string, fields: Record<string, unknown>, alias?: string,
) {
  const { accessToken, instanceUrl } = getOrgAuth(alias);
  return sfFetch(accessToken, instanceUrl, 'POST',
    `/services/data/${API_VERSION}/sobjects/${objectType}`, fields);
}

export async function updateRecord(
  objectType: string, id: string, fields: Record<string, unknown>, alias?: string,
) {
  const { accessToken, instanceUrl } = getOrgAuth(alias);
  // PATCH returns 204 No Content on success
  await sfFetch(accessToken, instanceUrl, 'PATCH',
    `/services/data/${API_VERSION}/sobjects/${objectType}/${id}`, fields);
  return { success: true, id };
}

export async function deleteRecord(objectType: string, id: string, alias?: string) {
  const { accessToken, instanceUrl } = getOrgAuth(alias);
  await sfFetch(accessToken, instanceUrl, 'DELETE',
    `/services/data/${API_VERSION}/sobjects/${objectType}/${id}`);
  return { success: true };
}

export async function executeApex(apexCode: string, alias?: string) {
  const { accessToken, instanceUrl } = getOrgAuth(alias);
  return sfFetch(accessToken, instanceUrl, 'GET',
    `/services/data/${API_VERSION}/tooling/executeAnonymous?anonymousBody=${encodeURIComponent(apexCode)}`);
}

export async function listSObjects(alias?: string) {
  const { accessToken, instanceUrl } = getOrgAuth(alias);
  return sfFetch(accessToken, instanceUrl, 'GET',
    `/services/data/${API_VERSION}/sobjects`);
}

export async function describeSObject(objectName: string, alias?: string) {
  const { accessToken, instanceUrl } = getOrgAuth(alias);
  return sfFetch(accessToken, instanceUrl, 'GET',
    `/services/data/${API_VERSION}/sobjects/${objectName}/describe`);
}

// Returns a compact field list for one or more objects — optimised for NL→SOQL use.
// Full describe is ~300KB per object; this strips it down to what's needed to write queries.
export async function schemaForQuery(objectNames: string[], alias?: string) {
  const { accessToken, instanceUrl } = getOrgAuth(alias);

  const results: Record<string, any> = {};

  await Promise.all(objectNames.map(async (name) => {
    const describe = await sfFetch(accessToken, instanceUrl, 'GET',
      `/services/data/${API_VERSION}/sobjects/${name}/describe`);

    results[name] = {
      label: describe.label,
      fields: describe.fields.map((f: any) => ({
        name: f.name,
        label: f.label,
        type: f.type,
        ...(f.type === 'picklist' && { picklistValues: f.picklistValues.map((p: any) => p.value) }),
        ...(f.referenceTo?.length && { referenceTo: f.referenceTo }),
        ...(f.relationshipName && { relationshipName: f.relationshipName }),
      })),
      childRelationships: describe.childRelationships
        .filter((r: any) => r.relationshipName)
        .map((r: any) => ({
          childObject: r.childSObject,
          field: r.field,
          relationshipName: r.relationshipName,
        })),
    };
  }));

  return results;
}

// ─── Flow / FlexiPage list via SOQL ───────────────────────────────────────────

export async function listFlows(alias?: string) {
  return soqlQuery(
    'SELECT Id, ApiName, Label, ProcessType, Status, ActiveVersionId FROM FlowDefinitionView ORDER BY Label',
    alias,
  );
}

export async function listFlexiPages(alias?: string) {
  return soqlQuery(
    'SELECT Id, DeveloperName, MasterLabel, Type FROM FlexiPage ORDER BY MasterLabel',
    alias,
  );
}

// ─── Metadata retrieve/deploy via SF CLI ──────────────────────────────────────

// Maps metadata type → folder under force-app/main/default/
const METADATA_FOLDERS: Record<string, string> = {
  Flow: 'flows',
  FlexiPage: 'flexipages',
  Layout: 'layouts',
  CustomObject: 'objects',
  ApexClass: 'classes',
  ApexTrigger: 'triggers',
  LightningComponentBundle: 'lwc',
  AuraDefinitionBundle: 'aura',
  PermissionSet: 'permissionsets',
  Profile: 'profiles',
  CustomLabel: 'labels',
  CustomTab: 'tabs',
  StaticResource: 'staticresources',
};

// Maps metadata type → file extension
const METADATA_EXTENSIONS: Record<string, string> = {
  Flow: 'flow-meta.xml',
  FlexiPage: 'flexipage-meta.xml',
  Layout: 'layout-meta.xml',
  CustomObject: 'object-meta.xml',
  ApexClass: 'cls-meta.xml',
  ApexTrigger: 'trigger-meta.xml',
  PermissionSet: 'permissionset-meta.xml',
  Profile: 'profile-meta.xml',
  CustomLabel: 'labels-meta.xml',
  StaticResource: 'resource-meta.xml',
};

function metadataFolder(type: string): string {
  return METADATA_FOLDERS[type] ?? `${type.toLowerCase()}s`;
}

function metadataExtension(type: string): string {
  return METADATA_EXTENSIONS[type] ?? `${type.toLowerCase()}-meta.xml`;
}

function walkXmlFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...walkXmlFiles(full));
    } else if (entry.endsWith('.xml')) {
      results.push(full);
    }
  }
  return results;
}

function createTempProject(dir: string): void {
  writeFileSync(join(dir, 'sfdx-project.json'), JSON.stringify({
    packageDirectories: [{ path: 'force-app', default: true }],
    sourceApiVersion: '62.0',
    name: 'sf-mcp-temp',
  }));
  mkdirSync(join(dir, 'force-app'), { recursive: true });
}

function runSfCli(command: string, cwd: string): any {
  let stdout: string;
  try {
    stdout = execSync(command, {
      encoding: 'utf8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120_000,
    });
  } catch (e: any) {
    stdout = e.stdout || '{}';
  }
  try {
    return JSON.parse(stdout);
  } catch {
    return { status: 1, message: redactSecretsFromCliText(stdout) };
  }
}

export function getMetadata(metadataType: string, fullName: string, alias?: string): string {
  const targetArg = alias ? `--target-org ${JSON.stringify(alias)}` : '';
  const tmpDir = mkdtempSync(join(tmpdir(), 'sf-mcp-retrieve-'));

  try {
    createTempProject(tmpDir);

    const result = runSfCli(
      `sf project retrieve start --metadata "${metadataType}:${fullName}" ${targetArg} --json`,
      tmpDir,
    );

    if (result.status !== 0) {
      const detail = redactSecretsFromCliText(
        String(result.message ?? JSON.stringify(result)),
      );
      throw new Error(`Retrieve failed: ${detail}`);
    }

    const xmlFiles = walkXmlFiles(join(tmpDir, 'force-app'));
    if (xmlFiles.length === 0) {
      throw new Error(`No metadata retrieved for ${metadataType}:${fullName}`);
    }

    return readFileSync(xmlFiles[0], 'utf8');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function deployMetadata(
  metadataType: string,
  fullName: string,
  xmlContent: string,
  alias?: string,
): string {
  const targetArg = alias ? `--target-org ${JSON.stringify(alias)}` : '';
  const tmpDir = mkdtempSync(join(tmpdir(), 'sf-mcp-deploy-'));

  try {
    createTempProject(tmpDir);

    const metaDir = join(tmpDir, 'force-app', 'main', 'default', metadataFolder(metadataType));
    mkdirSync(metaDir, { recursive: true });
    writeFileSync(join(metaDir, `${fullName}.${metadataExtension(metadataType)}`), xmlContent);

    const result = runSfCli(
      `sf project deploy start --source-dir force-app ${targetArg} --json`,
      tmpDir,
    );

    if (result.status !== 0) {
      const detail = redactSecretsFromCliText(
        String(result.message ?? JSON.stringify(result)),
      );
      throw new Error(`Deploy failed: ${detail}`);
    }

    return JSON.stringify(result.result?.deployedSource ?? result.result ?? { success: true }, null, 2);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
