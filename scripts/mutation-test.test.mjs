import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./mutation-test.mjs', import.meta.url));
const id = 'request-property-added:POST /customers:request-body:/hooktierMutationProbe';
const spec = `openapi: 3.1.0
info:
  title: Fixture
  version: '1'
servers:
  - url: https://example.test/v1
paths:
  /customers:
    post:
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CustomerCreate'
      responses:
        '201':
          description: Created
components:
  schemas:
    CustomerCreate:
      type: object
      additionalProperties: false
      required: [uid]
      properties:
        uid:
          type: string
    CustomerUpdate:
      type: object
      properties:
        name:
          type: string
`;

function fixture(t, mode) {
  const root = mkdtempSync(join(tmpdir(), 'mutation-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bundle = join(root, 'fake bundle');
  mkdirSync(join(bundle, 'tools'), { recursive: true });
  writeFileSync(join(bundle, 'openapi.yaml'), spec);
  const binary = join(root, 'fake oasdiff');
  const receipt = join(root, 'receipt.json');
  const changesReceipt = join(root, 'changes-ran');
  writeFileSync(binary, `#!${process.execPath}
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
assert.deepEqual(args.slice(0, 3), ['diff', '--format', 'json']);
assert.equal(args.length, 5);
assert.equal(args[3], ${JSON.stringify(join(bundle, 'openapi.yaml'))});
assert.notEqual(args[3], args[4]);
const before = readFileSync(args[3], 'utf8');
const after = readFileSync(args[4], 'utf8');
assert.equal(after, before.replace('      properties:\\n', '      properties:\\n        hooktierMutationProbe:\\n          type: string\\n'));
writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({ copy: args[4] }));
if (${JSON.stringify(mode)} === 'oasdiff-failure') {
  console.error('synthetic oasdiff error');
  process.exit(7);
}
console.log(JSON.stringify({ fixtureMode: ${JSON.stringify(mode)} }));
`);
  chmodSync(binary, 0o755);
  writeFileSync(join(bundle, 'tools', 'changes.mjs'), `
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
assert.equal(args.length, 6);
assert.equal(args[0], '--oasdiff');
assert.deepEqual(args.slice(2), ['--from', '0', '--to', '1']);
const diff = JSON.parse(readFileSync(args[1], 'utf8'));
assert.equal(diff.fixtureMode, ${JSON.stringify(mode)});
writeFileSync(${JSON.stringify(changesReceipt)}, 'ran');
const changes = diff.fixtureMode === 'missing-id' ? [] : [{ id: ${JSON.stringify(id)} }];
if (diff.fixtureMode === 'extra-id') changes.push({ id: 'request-property-added:POST /customers:request-body:/extra' });
console.log(JSON.stringify({ fromBundle: 0, toBundle: 1, changes }));
`);
  return { bundle, binary, receipt, changesReceipt };
}

function invoke(t, mode) {
  const data = fixture(t, mode);
  const result = spawnSync(process.execPath, [script, '--bundle', data.bundle, '--oasdiff', data.binary], { encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(readFileSync(join(data.bundle, 'openapi.yaml'), 'utf8'), spec);
  assert.deepEqual(readdirSync(data.bundle).sort(), ['openapi.yaml', 'tools']);
  const { copy } = JSON.parse(readFileSync(data.receipt, 'utf8'));
  assert.equal(existsSync(dirname(copy)), false, 'temporary mutation directory is removed');
  assert.equal(existsSync(data.changesReceipt), mode !== 'oasdiff-failure');
  assert.doesNotMatch(result.stderr, /Warning:/);
  return result;
}

// K14: the optional request property is reported using the spec path, without /v1.
test('passes when exactly the optional property change ID is reported', t => {
  const result = invoke(t, 'pass');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, `Mutation test passed: ${id}\n`);
});

// K14: an additive field cannot pass unnoticed.
test('fails when the property change ID is missing', t => {
  const result = invoke(t, 'missing-id');
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.includes(`Expected exactly one change ID: ${id}`));
});

// K14: the mutation must produce exactly one change, not just include its ID.
test('fails when an extra change ID is reported', t => {
  const result = invoke(t, 'extra-id');
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.includes(`Expected exactly one change ID: ${id}`));
  assert.ok(result.stderr.includes('request-body:/extra'));
});

// K14: a failed diff must never be interpreted as a successful mutation check.
test('fails when oasdiff exits unsuccessfully', t => {
  const result = invoke(t, 'oasdiff-failure');
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /oasdiff failed \(exit 7\): synthetic oasdiff error/);
});
