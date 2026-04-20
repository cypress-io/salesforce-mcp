import { execSync } from 'child_process';

export interface OrgAuth {
  accessToken: string;
  instanceUrl: string;
  username: string;
}

/** Strip credential-like fields from raw CLI text before it can appear in thrown errors. */
export function redactSecretsFromCliText(text: string): string {
  return text
    .replace(/"accessToken"\s*:\s*"[^"\\]*(?:\\.[^"\\]*)*"/gi, '"accessToken":"<redacted>"')
    .replace(/"refreshToken"\s*:\s*"[^"\\]*(?:\\.[^"\\]*)*"/gi, '"refreshToken":"<redacted>"')
    .replace(/"clientSecret"\s*:\s*"[^"\\]*(?:\\.[^"\\]*)*"/gi, '"clientSecret":"<redacted>"')
    .replace(/"sfdxAuthUrl"\s*:\s*"[^"\\]*(?:\\.[^"\\]*)*"/gi, '"sfdxAuthUrl":"<redacted>"');
}

function runSfCommand(command: string): any {
  let stdout: string;
  try {
    stdout = execSync(command, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e: any) {
    // SF CLI writes JSON to stdout even on error exits
    stdout = e.stdout || '{}';
  }
  try {
    return JSON.parse(stdout);
  } catch {
    const safe = redactSecretsFromCliText(stdout);
    const clip = safe.length > 2000 ? `${safe.slice(0, 2000)}…` : safe;
    throw new Error(`Failed to parse SF CLI output: ${clip}`);
  }
}

export function getOrgAuth(alias?: string): OrgAuth {
  const targetArg = alias ? `--target-org ${JSON.stringify(alias)}` : '';
  const parsed = runSfCommand(`sf org display ${targetArg} --json`);

  if (parsed.status !== 0) {
    const detail = redactSecretsFromCliText(
      typeof parsed.message === 'string' ? parsed.message : JSON.stringify(parsed),
    );
    throw new Error(`SF CLI error: ${detail}`);
  }

  const { accessToken, instanceUrl, username } = parsed.result ?? {};
  if (!accessToken) {
    throw new Error('No access token — run: sf org login web');
  }

  return { accessToken, instanceUrl, username };
}

/** Keys SF CLI may include in org list JSON — never surface these over MCP. */
const LIST_ORGS_SECRET_KEYS = new Set([
  'accessToken',
  'refreshToken',
  'clientSecret',
  'sfdxAuthUrl',
  'password',
]);

function redactOrgListPayload(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redactOrgListPayload);
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (LIST_ORGS_SECRET_KEYS.has(k)) {
        continue;
      }
      out[k] = redactOrgListPayload(v);
    }
    return out;
  }
  return value;
}

export function listOrgs(): unknown {
  const parsed = runSfCommand('sf org list --json');
  const result = parsed.result ?? {};
  return redactOrgListPayload(result);
}
