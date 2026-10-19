'use strict';
const { spawn } = require('node:child_process');
const { isSshHost } = require('../lib/remote-sdk.cjs');
function absolutePath(value, label = 'folder') {
  if (typeof value !== 'string' || !value.startsWith('/') || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`The remote ${label} must be an absolute path without control characters.`);
  }
  return value;
}
function target(editor, host, folder) {
  if (!isSshHost(host)) throw new Error('Invalid Tempest SSH alias.');
  absolutePath(folder);
  if (editor === 'zed') return { executable: 'zed', args: [`ssh://${host}${folder.split('/').map(encodeURIComponent).join('/')}`] };
  if (editor === 'cursor') return { executable: 'cursor', args: ['--new-window', '--remote', `ssh-remote+${host}`, folder] };
  throw new Error('Choose zed or cursor.');
}

function openTarget(connection, executable) {
  return new Promise((resolve, reject) => {
    const name = executable || connection.executable;
    const child = spawn(name, connection.args, {shell: false, windowsHide: true, stdio: 'ignore'});
    const timer = setTimeout(() => {child.kill(); reject(new Error(`${name} timed out.`));}, 30000);
    child.once('error', () => {clearTimeout(timer); reject(new Error(`Cannot launch ${name}. Check installation and PATH.`));});
    child.once('close', code => {clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`${name} exited (${code}).`));});
  });
}
module.exports = {absolutePath, target, openTarget};
