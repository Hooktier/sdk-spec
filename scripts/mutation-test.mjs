import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const propertyName = 'hooktierMutationProbe';
const expectedId = `request-property-added:POST /customers:request-body:/${propertyName}`;

function options(args) {
  const values = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (!['--bundle', '--oasdiff'].includes(flag) || !value || value.startsWith('--') || values.has(flag)) {
      throw new Error('Usage: node scripts/mutation-test.mjs --bundle <dir> --oasdiff <binary>');
    }
    values.set(flag, value);
  }
  if (values.size !== 2) {
    throw new Error('Usage: node scripts/mutation-test.mjs --bundle <dir> --oasdiff <binary>');
  }
  return { bundle: resolve(values.get('--bundle')), oasdiff: values.get('--oasdiff') };
}

function mutate(text) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(newline);
  let start = 0;
  let end = lines.length;
  let parentIndent = -1;
  // Follow block mappings in the exported spec; never match a description or another schema.
  for (const key of ['components', 'schemas', 'CustomerCreate', 'properties']) {
    const matches = [];
    let childIndent;
    for (let i = start; i < end; i++) {
      if (/^\s*(?:#.*)?$/.test(lines[i])) continue;
      const indent = lines[i].match(/^ */)[0].length;
      if (childIndent === undefined) childIndent = indent;
      if (indent === childIndent && indent > parentIndent &&
          new RegExp(`^ *(?:${key}|"${key}"|'${key}'):\\s*(?:#.*)?$`).test(lines[i])) {
        matches.push(i);
      }
    }
    if (matches.length !== 1) throw new Error(`Expected one block mapping for ${key} in CustomerCreate's schema path`);
    const index = matches[0];
    parentIndent = lines[index].match(/^ */)[0].length;
    start = index + 1;
    for (end = start; end < lines.length; end++) {
      if (/^\s*(?:#.*)?$/.test(lines[end])) continue;
      if (lines[end].match(/^ */)[0].length <= parentIndent) break;
    }
  }
  const first = lines.slice(start, end).find(line => !/^\s*(?:#.*)?$/.test(line));
  if (!first) throw new Error('CustomerCreate.properties must contain a block property mapping');
  if (text.includes(propertyName)) throw new Error(`Mutation property ${propertyName} already exists in the spec`);
  const indent = first.match(/^ */)[0];
  lines.splice(start, 0, `${indent}${propertyName}:`, `${indent}  type: string`);
  return lines.join(newline);
}

function run(binary, args, label) {
  try {
    return execFileSync(binary, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const detail = error.stderr?.trim() || error.message;
    throw new Error(`${label} failed${error.status === null || error.status === undefined ? '' : ` (exit ${error.status})`}: ${detail}`);
  }
}

try {
  const { bundle, oasdiff } = options(process.argv.slice(2));
  const temporary = mkdtempSync(join(tmpdir(), 'bundle-mutation-'));
  try {
    const original = join(bundle, 'openapi.yaml');
    const copy = join(temporary, 'openapi.yaml');
    const diff = join(temporary, 'oasdiff.json');
    copyFileSync(original, copy);
    writeFileSync(copy, mutate(readFileSync(copy, 'utf8')));
    writeFileSync(diff, run(oasdiff, ['diff', '--format', 'json', original, copy], 'oasdiff'));
    const output = run(process.execPath, [join(bundle, 'tools', 'changes.mjs'), '--oasdiff', diff, '--from', '0', '--to', '1'], 'changes.mjs');
    const result = JSON.parse(output);
    if (result?.fromBundle !== 0 || result?.toBundle !== 1 || !Array.isArray(result?.changes) ||
        result.changes.length !== 1 || result.changes[0]?.id !== expectedId) {
      throw new Error(`Expected exactly one change ID: ${expectedId}; received ${JSON.stringify(result)}`);
    }
    console.log(`Mutation test passed: ${expectedId}`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
} catch (error) {
  console.error(`Mutation test failed: ${error.message}`);
  process.exitCode = 1;
}
