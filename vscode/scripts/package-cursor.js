'use strict';
const { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const stage = mkdtempSync(path.join(tmpdir(), 'tempest-cursor-'));
try {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  manifest.name = 'tempest-remote-cursor';
  manifest.displayName = 'Tempest Remote for Cursor';
  manifest.description = 'Open saved Tempest SSH servers in Cursor with Tempest CLI and Anysphere Remote SSH.';
  manifest.extensionDependencies = ['anysphere.remote-ssh'];
  manifest.scripts = {};
  delete manifest.devDependencies;
  writeFileSync(path.join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  for (const name of ['src','media','README.md','LICENSE']) cpSync(path.join(root, name), path.join(stage, name), { recursive: true });
  const sdk = path.resolve(path.dirname(require.resolve('@tempest-term/remote-sdk')), '..');
  mkdirSync(path.join(stage, 'node_modules/@tempest-term'), { recursive: true });
  cpSync(sdk, path.join(stage, 'node_modules/@tempest-term/remote-sdk'), { recursive: true });
  const vsce = require.resolve('@vscode/vsce/vsce');
  const output = path.join(root, `tempest-remote-cursor-${manifest.version}.vsix`);
  const result = spawnSync(process.execPath, [vsce, 'package','--allow-missing-repository','--out',output], { cwd: stage, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status || 1;
} finally { rmSync(stage, { recursive: true, force: true }); }
