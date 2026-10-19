'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { ClientSecretCredential } = require('@azure/identity');
const { publishVSIX } = require('@vscode/vsce');
const manifest = require('../package.json');
const scope = '499b84ac-1321-427f-aa17-267ca6975798/.default';

async function readProfile(token) {
  const response = await fetch('https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1', {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Identity profile request failed (HTTP ${response.status}).`);
  const profile = await response.json();
  if (typeof profile.id !== 'string') throw new Error('Identity profile has no ID.');
  return profile.id;
}

async function run({ env = process.env, verifyOnly = false,
  createCredential = options => new ClientSecretCredential(options.tenantId, options.clientId, options.clientSecret),
  publish = publishVSIX, getProfile = readProfile,
  packagePath = path.resolve(`tempest-remote-vscode-${manifest.version}.vsix`) } = {}) {
  for (const name of ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET']) {
    if (!env[name]) throw new Error(`Missing ${name}.`);
  }
  for (const name of ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID']) {
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(env[name])) {
      throw new Error(`Invalid ${name}.`);
    }
  }
  if (env.CI_COMMIT_REF_PROTECTED !== 'true' || !env.CI_COMMIT_TAG) {
    throw new Error('Marketplace identity is restricted to protected tag pipelines.');
  }
  if (!verifyOnly && env.CI_COMMIT_TAG !== `v${manifest.version}`) {
    throw new Error('Release tag does not match package version.');
  }
  if (!verifyOnly) await fs.access(packagePath);
  const credential = createCredential({ tenantId: env.AZURE_TENANT_ID,
    clientId: env.AZURE_CLIENT_ID, clientSecret: env.AZURE_CLIENT_SECRET });
  const access = await credential.getToken(scope);
  if (!access?.token) throw new Error('Entra returned no access token.');
  if (verifyOnly) {
    // Only the public service-principal identifier is exposed, never the JWT.
    try {
      const claims = JSON.parse(Buffer.from(access.token.split('.')[1], 'base64url').toString('utf8'));
      if (typeof claims.oid === 'string' && /^[a-f0-9-]{36}$/i.test(claims.oid)) {
        console.log(JSON.stringify({ entraAuthenticated: true, principalObjectId: claims.oid }));
      }
    } catch { /* Profile lookup below is authoritative. */ }
    const profileId = await getProfile(access.token);
    console.log(JSON.stringify({ publisher: manifest.publisher, profileId,
      tenantId: env.AZURE_TENANT_ID, clientId: env.AZURE_CLIENT_ID }));
    return;
  }
  // vsce's API uses this option for Entra access tokens too. The short-lived
  // token stays in this process; it is never passed in argv or saved as a PAT.
  await publish(packagePath, { pat: access.token });

}

function diagnostic(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  return message.match(/\bAADSTS[0-9]+\b/)?.[0]
    || message.match(/\bHTTP [1-5][0-9]{2}\b/)?.[0]
    || message.match(/\b(?:Missing|Invalid) (?:AZURE_TENANT_ID|AZURE_CLIENT_ID|AZURE_CLIENT_SECRET)\b/)?.[0]
    || 'No safe error code available';
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--verify-auth')) {
    console.error('Usage: node scripts/publish-marketplace.js [--verify-auth]');
    process.exitCode = 1;
  } else {
    run({ verifyOnly: args.includes('--verify-auth') }).catch(error => {
      // SDK/HTTP exceptions may contain credentials or headers. Keep tokens out
      // of CI logs; diagnose identity configuration in Entra and publisher UI.
      console.error('Entra publishing failed (' + diagnostic(error) + '). Check CI identity variables, client secret and publisher permissions.');
      process.exitCode = 1;
    });
  }
}
module.exports = { run, diagnostic };
