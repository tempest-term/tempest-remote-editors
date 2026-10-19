'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { version } = require('../package.json');
const root = path.resolve(__dirname, '..');
const result = spawnSync(process.execPath, [require.resolve('@vscode/vsce/vsce'), 'package',
  '--allow-missing-repository', '--out', path.join(root, `tempest-remote-vscode-${version}.vsix`)],
  { cwd: root, stdio: 'inherit', shell: false });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
