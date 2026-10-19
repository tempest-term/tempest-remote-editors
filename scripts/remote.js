#!/usr/bin/env node
'use strict';
const { spawn } = require('node:child_process');
const { parseArgs } = require('node:util');
const readline = require('node:readline');
const { ControlClient } = require('../lib/remote-sdk.cjs');
const { absolutePath, target, openTarget } = require('./clients');
let cancelPrompt;
let promptBridge = false;
let bridgeInput;
function progress(stage, message) {
  if (promptBridge) console.log(JSON.stringify({ type: 'progress', stage, message }));
}

function selectServer(servers, { server, serverId }) {
  const matches = servers.filter(entry => serverId ? entry.id === serverId
    : entry.label.toLowerCase() === server.toLowerCase());
  if (matches.length !== 1) throw new Error('Server missing or label ambiguous. Run list and use an exact --server-id.');
  return matches[0];
}
// Only the local terminal receives authentication input. Passwords never echo.
function readAnswer(message, hidden = false) {
  const input = process.stdin;
  const output = process.stderr;
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    output.write('Authentication needs an interactive local terminal. Run this command there; do not send answers in chat.\n');
    return Promise.resolve(undefined);
  }
  output.write(`${message}\n> `);
  readline.emitKeypressEvents(input);
  const wasRaw = Boolean(input.isRaw);
  input.setRawMode(true);
  input.resume();
  return new Promise(resolve => {
    let answer = '';
    let finished = false;
    function finish(value) {
      if (finished) return;
      finished = true;
      cancelPrompt = undefined;
      input.removeListener('keypress', onKey);
      input.removeListener('end', onEnd);
      input.setRawMode(wasRaw);
      input.pause();
      output.write('\n');
      resolve(value);
    }
    const onEnd = () => finish(undefined);
    cancelPrompt = onEnd;
    function onKey(text, key = {}) {
      if (key.ctrl && ['c', 'd'].includes(key.name)) return finish(undefined);
      if (key.name === 'return' || key.name === 'enter') return finish(answer);
      if (key.name === 'backspace') {
        if (answer) {
          answer = [...answer].slice(0, -1).join('');
          if (!hidden) output.write('\b \b');
        }
      } else if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(text)) {
        answer += text;
        if (!hidden) output.write(text);
      }
    }
    input.on('keypress', onKey);
    input.once('end', onEnd);
  });
}
async function showPrompt(prompt) {
  if (promptBridge) {
    bridgeInput ||= readline.createInterface({ input: process.stdin });
    console.log(JSON.stringify({ type: 'prompt', prompt }));
    return new Promise(resolve => {
      const finish = value => { bridgeInput.off('line', line); bridgeInput.off('close', close); cancelPrompt = undefined; resolve(value); };
      const close = () => finish(undefined);
      const line = text => {
        try { const frame = JSON.parse(text); if (frame.id === prompt.id) finish(frame.answer ?? undefined); }
        catch { finish(undefined); }
      };
      cancelPrompt = close;
      bridgeInput.on('line', line); bridgeInput.once('close', close);
    });
  }
  if (prompt.kind === 'select') {
    const answer = await readAnswer(`${prompt.message}\n${(prompt.choices || []).map((c, i) => `${i + 1}. ${c.label}`).join('\n')}`);
    const index = Number(answer) - 1;
    return Number.isInteger(index) && index >= 0 ? prompt.choices?.[index]?.id : undefined;
  }
  if (!['password', 'text', 'confirm'].includes(prompt.kind)) return undefined;
  const answer = await readAnswer(prompt.kind === 'confirm'
    ? `${prompt.message}\nAccept? [y/N]` : prompt.message, prompt.kind === 'password');
  if (answer === undefined) return undefined;
  return prompt.kind === 'confirm' ? /^(y|yes)$/i.test(answer.trim()) : answer;
}

function exited(child) {
  return new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error('Cannot launch OpenSSH. Check ssh on PATH.')));
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}
async function probeSsh(args, spawnProcess = spawn) {
  const child = spawnProcess('ssh', args, { stdio: 'ignore', shell: false, windowsHide: true });
  const timer = setTimeout(() => child.kill(), 25000);
  try {
    const result = await exited(child);
    if (result.code !== 0) throw new Error('SSH attach failed. Retry connect to refresh the session.');
  } finally { clearTimeout(timer); }
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    'cli-path': { type: 'string', default: 'tempest' },
    account: { type: 'string' }, server: { type: 'string' },
    'server-id': { type: 'string' }, editor: { type: 'string' }, folder: { type: 'string' },
    'editor-path': { type: 'string' }, 'no-open': { type: 'boolean' },
    'prompt-json': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: tempest-remote list | connect --server LABEL [--editor zed|cursor --folder /path] [--no-open] [--cli-path PATH] [--account ID]');
    return;
  }
  promptBridge = Boolean(values['prompt-json']);
  const [command] = positionals;
  if (positionals.length !== 1 || !['list', 'connect'].includes(command)) throw new Error('Choose list or connect. Use --help for usage.');
  if (command === 'connect' && Number(Boolean(values.server)) + Number(Boolean(values['server-id'])) !== 1) {
    throw new Error('Connect requires exactly one of --server or --server-id.');
  }
  if (values.editor && !['zed','cursor','jetbrains'].includes(values.editor)) throw new Error('Unknown editor.');
  const jetbrains = values.editor === 'jetbrains';
  if (values.editor && !jetbrains) absolutePath(values.folder);
  if (jetbrains && !promptBridge) throw new Error('Use the Tempest connection page in JetBrains Gateway.');
  const control = new ControlClient(values['cli-path'], showPrompt, { account: values.account });
  let keepalive;
  let prepared = false;
  let stopping = false;
  const stop = () => {
    stopping = true;
    cancelPrompt?.();
    if (prepared) control.dispose(); else control.cancel();
    keepalive?.kill();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    progress('servers', 'Loading saved servers…');
    const servers = await control.listServers();
    if (command === 'list') {
      console.log(JSON.stringify({ type: 'servers', servers }));
      return;
    }
    const server = selectServer(servers, { server: values.server, serverId: values['server-id'] });
    progress('ssh', 'Authenticating and preparing the SSH connection…');
    const remote = await control.ensureRemote(server.id);
    prepared = true;
    if (jetbrains) {
      if (stopping) return;
      if (!remote.ssh || remote.ssh.host !== '127.0.0.1' ||
          !Number.isInteger(remote.ssh.port) || remote.ssh.port < 1 || remote.ssh.port > 65535 ||
          !remote.ssh.identityFile || !remote.ssh.hostKey) {
        throw new Error('This Tempest session does not expose a direct SSH endpoint. Update Tempest CLI and reconnect the server.');
      }
      console.log(JSON.stringify({type: 'connected', gateway: {
        ...remote.ssh, sshHost: remote.sshHost,
        label: server.description ? `${server.label} (${server.description})` : server.label,
      }}));
      // Gateway connects to the CLI’s existing SSH listener directly.
      return;
    }
    const sshArgs = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o',
      'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3'];
    keepalive = spawn('ssh', [...sshArgs, '-N', remote.sshHost], {
      stdio: 'ignore', shell: false, windowsHide: true, detached: true,
    });
    const alive = exited(keepalive);
    alive.catch(() => {}); // Observe early spawn errors while the probe runs.
    progress('ssh_probe', 'Checking the SSH connection…');
    await probeSsh([...sshArgs, remote.sshHost, 'true']);
    if (keepalive.exitCode !== null || keepalive.signalCode !== null || stopping) {
      throw new Error('SSH keepalive ended before handoff. Retry connect.');
    }
    control.dispose();
    const connection = values.editor ? target(values.editor, remote.sshHost, values.folder) : undefined;
    if (stopping) throw new Error('Cancelled.');
    if (connection && !values['no-open']) {
      progress('open_editor', 'Opening the remote project…');
      await openTarget(connection, values['editor-path']);
    }
    console.log(JSON.stringify({ type: 'connected', sshHost: remote.sshHost, editor: values.editor, target: connection, status: 'connected' }));
    console.error('Keep this command running while using the host. Ctrl+C releases its SSH attach.');
    const result = await alive;
    if (!stopping) throw new Error(`SSH keepalive ended (${result.signal || result.code}). Run connect again before reopening the host.`);
  } finally {
    cancelPrompt?.();
    bridgeInput?.close();
    if (prepared) control.dispose(); else control.cancel();
    keepalive?.kill();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    if (stopping) process.exitCode = 130;
  }
}

if (require.main === module) main().catch(error => {
  if (process.exitCode === 130 || ['AbortError','CancellationError'].includes(error.name)) { process.exitCode = 130; return; }
  const message = error?.code?.startsWith('ERR_PARSE_ARGS') ? 'Invalid arguments. Use --help for usage.' : error.message;
  if (promptBridge) console.log(JSON.stringify({ type: 'error', message }));
  else console.error(message);
  process.exitCode = 1;
});
module.exports = { selectServer, probeSsh };
