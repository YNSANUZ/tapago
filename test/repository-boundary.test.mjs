import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function filesUnder(directory) {
  if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(fullPath) : [fullPath];
  });
}

test('the Git repository boundary is the TáPago app directory', () => {
  const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(path.resolve(gitRoot), root);
  assert.notEqual(path.resolve(gitRoot, '..', '..'), path.resolve(gitRoot));
});

test('.env is ignored while the sanitized example remains trackable', () => {
  const ignored = spawnSync('git', ['check-ignore', '-q', '.env'], { cwd: root });
  assert.equal(ignored.status, 0, '.env must be ignored by Git');
  const exampleIgnored = spawnSync('git', ['check-ignore', '-q', '.env.example'], { cwd: root });
  assert.equal(exampleIgnored.status, 1, '.env.example must remain publishable');
});

test('.env.example contains blank public settings and no privileged key', () => {
  const file = path.join(root, '.env.example');
  assert.equal(statSync(file, { throwIfNoEntry: false })?.isFile(), true, '.env.example must exist');
  const content = readFileSync(file, 'utf8');
  assert.match(content, /^VITE_SUPABASE_URL=\s*$/m);
  assert.match(content, /^VITE_SUPABASE_ANON_KEY=\s*$/m);
  assert.doesNotMatch(content, /SERVICE_ROLE|SECRET|PRIVATE_KEY/i);
});

test('the distributable exists and contains no service-role credential', () => {
  const bundle = filesUnder(path.join(root, 'dist'));
  assert.ok(bundle.length > 0, 'the static build must exist');
  for (const file of bundle) {
    const content = readFileSync(file, 'utf8');
    assert.doesNotMatch(content, /SUPABASE_SERVICE_ROLE_KEY|service_role|sb_secret_[A-Za-z0-9_-]{12,}/i, path.relative(root, file));
  }
});
