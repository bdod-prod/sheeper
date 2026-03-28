import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const DEFAULT_PROJECT = 'sheeper';
const SECRET_KEYS = [
  'SHEEPER_TOKEN',
  'GITHUB_TOKEN',
  'CLAUDE_API_KEY',
  'OPENAI_API_KEY',
  'XAI_API_KEY'
];

const args = process.argv.slice(2);
const projectName = readFlagValue(args, '--project') || DEFAULT_PROJECT;
const onlyList = (readFlagValue(args, '--only') || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

const selectedKeys = onlyList.length
  ? SECRET_KEYS.filter(key => onlyList.includes(key))
  : SECRET_KEYS;

if (!selectedKeys.length) {
  console.error('No valid secret keys selected. Use --only with one of:', SECRET_KEYS.join(', '));
  process.exit(1);
}

const envPath = resolve('.dev.vars');
const envVars = await parseEnvFile(envPath);

const uploads = selectedKeys
  .map(key => ({ key, value: envVars[key] ?? '' }))
  .filter(entry => entry.value);

if (!uploads.length) {
  console.log('No non-empty secrets found in .dev.vars for upload.');
  process.exit(0);
}

for (const { key, value } of uploads) {
  console.log(`Uploading ${key} to Pages project "${projectName}"...`);
  await putSecret(projectName, key, value);
}

console.log(`Uploaded ${uploads.length} secret(s) to "${projectName}".`);

async function parseEnvFile(filePath) {
  const content = await readFile(filePath, 'utf8');
  const result = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const equalsIndex = line.indexOf('=');
    if (equalsIndex === -1) continue;

    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1);
    result[key] = value;
  }

  return result;
}

async function putSecret(project, key, value) {
  const isWindows = process.platform === 'win32';
  const command = isWindows ? (process.env.ComSpec || 'cmd.exe') : 'npx';
  const commandArgs = isWindows
    ? ['/d', '/s', '/c', 'npx', '--yes', 'wrangler@4.78.0', 'pages', 'secret', 'put', key, '--project-name', project]
    : ['--yes', 'wrangler@4.78.0', 'pages', 'secret', 'put', key, '--project-name', project];

  const child = spawn(command, commandArgs, {
    stdio: ['pipe', 'inherit', 'inherit']
  });

  child.stdin.write(value);
  child.stdin.end();

  const exitCode = await new Promise((resolvePromise, rejectPromise) => {
    child.on('error', rejectPromise);
    child.on('close', resolvePromise);
  });

  if (exitCode !== 0) {
    throw new Error(`Failed to upload ${key}. Wrangler exited with code ${exitCode}.`);
  }
}

function readFlagValue(values, flagName) {
  const index = values.indexOf(flagName);
  if (index === -1) return null;
  return values[index + 1] ?? null;
}
