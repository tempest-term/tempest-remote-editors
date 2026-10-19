'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { run, diagnostic } = require('../scripts/publish-marketplace');
const version = require('../package.json').version;
function environment() {
  return { AZURE_TENANT_ID: '7ad0b673-2b2b-4e4e-8757-d3e0aeb89b50',
    AZURE_CLIENT_ID: '00000000-0000-4000-8000-000000000001',
    AZURE_CLIENT_SECRET: 'fake-entra-secret', CI_COMMIT_REF_PROTECTED: 'true',
    CI_COMMIT_TAG: `v${version}` };
}

test('reject unprotected, missing or mismatched identity inputs before authentication', async () => {
  const createCredential = () => assert.fail('must not authenticate');
  for (const change of [{ CI_COMMIT_REF_PROTECTED: 'false' }, { CI_COMMIT_TAG: '' },
    { AZURE_CLIENT_SECRET: '' }, { AZURE_CLIENT_ID: '' }, { AZURE_TENANT_ID: 'not-a-tenant' },
    { CI_COMMIT_TAG: 'v0.0.0' }]) {
    await assert.rejects(run({ env: { ...environment(), ...change }, createCredential }));
  }
});

test('use the app secret for Entra and pass only its short-lived access token to vsce', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tempest-publish-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const packagePath = path.join(directory, `tempest-remote-vscode-${version}.vsix`);
  await fs.writeFile(packagePath, 'test-package');
  let published;
  const env = environment();
  await run({ env, packagePath, createCredential: options => {
    assert.deepEqual(options, { tenantId: env.AZURE_TENANT_ID,
      clientId: env.AZURE_CLIENT_ID, clientSecret: env.AZURE_CLIENT_SECRET });
    return { getToken: async scope => {
      assert.equal(scope, '499b84ac-1321-427f-aa17-267ca6975798/.default');
      return { token: 'short-lived-entra-token' };
    } };
  }, publish: async (file, options) => { published = { file, options }; } });
  assert.equal(published.file, packagePath);
  assert.deepEqual(published.options, { pat: 'short-lived-entra-token' });
});

test('verification logs only public identity IDs and never publishes', async () => {
  const principal = '00000000-0000-4000-8000-000000000001';
  const token = 'header.' + Buffer.from(JSON.stringify({ oid: principal, secret: 'sensitive-payload' })).toString('base64url') + '.signature';
  const original = console.log;
  const output = [];
  console.log = line => output.push(line);
  try {
    await run({ env: { ...environment(), CI_COMMIT_TAG: 'entra-auth-check-3' }, verifyOnly: true,
      createCredential: () => ({ getToken: async () => ({ token }) }),
      getProfile: async () => 'profile-id', publish: () => assert.fail('must not publish') });
    assert.equal(JSON.parse(output[0]).principalObjectId, principal);
    assert.equal(JSON.parse(output[1]).profileId, 'profile-id');
    assert.ok(!output.join(' ').includes(token));
    assert.ok(!output.join(' ').includes('sensitive-payload'));
    assert.ok(!output.join(' ').includes(environment().AZURE_CLIENT_SECRET));
  } finally { console.log = original; }
});

test('diagnostics expose only error codes, never secret-bearing messages', () => {
  assert.equal(diagnostic(new Error('secret-token AADSTS700213 client assertion sensitive')), 'AADSTS700213');
  assert.equal(diagnostic(new Error('Identity profile request failed (HTTP 403).')), 'HTTP 403');
  assert.equal(diagnostic(new Error('Missing AZURE_CLIENT_SECRET.')), 'Missing AZURE_CLIENT_SECRET');
  assert.equal(diagnostic(new Error('secret=confidential')), 'No safe error code available');
});
