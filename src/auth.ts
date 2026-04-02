import { execSync } from 'child_process';

export interface OrgAuth {
  accessToken: string;
  instanceUrl: string;
  username: string;
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
    throw new Error(`Failed to parse SF CLI output: ${stdout}`);
  }
}

export function getOrgAuth(alias?: string): OrgAuth {
  const targetArg = alias ? `--target-org ${JSON.stringify(alias)}` : '';
  const parsed = runSfCommand(`sf org display ${targetArg} --json`);

  if (parsed.status !== 0) {
    throw new Error(`SF CLI error: ${parsed.message ?? JSON.stringify(parsed)}`);
  }

  const { accessToken, instanceUrl, username } = parsed.result ?? {};
  if (!accessToken) {
    throw new Error('No access token — run: sf org login web');
  }

  return { accessToken, instanceUrl, username };
}

export function listOrgs(): any {
  const parsed = runSfCommand('sf org list --json');
  return parsed.result ?? {};
}
