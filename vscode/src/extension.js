'use strict';
const vscode = require('vscode');
const { createRequire } = require('node:module');
const path = require('node:path');
const { ControlClient, isSshHost } = require('@tempest-term/remote-sdk');

async function showPrompt(prompt, token) {
  if (token?.isCancellationRequested) return undefined;
  if (prompt.kind === 'confirm') {
    const answer = await vscode.window.showWarningMessage(prompt.message,
      { modal: true }, 'Confirm');
    return answer === 'Confirm' ? true : undefined;
  }
  if (prompt.kind === 'select') {
    if (!Array.isArray(prompt.choices) || !prompt.choices.every(choice =>
      typeof choice.id === 'string' && typeof choice.label === 'string')) {
      throw new Error('Invalid prompt choices');
    }
    const choice = await vscode.window.showQuickPick(prompt.choices, { title: prompt.message }, token);
    return choice?.id;
  }
  return vscode.window.showInputBox({
    title: 'Tempest Authentication', prompt: prompt.message,
    password: prompt.kind === 'password', ignoreFocusOut: true,
  }, token);
}

async function activate(context) {
  let connecting = false;
  const clients = new Set();
  const output = vscode.window.createOutputChannel('Tempest Remote');
  context.subscriptions.push(output);
  const reportError = error => {
    if (error?.name === 'CancellationError') return;
    const message = error instanceof Error ? error.message : 'Tempest connection failed.';
    output.appendLine(`Connection failed: ${message}`);
    // Notification promises may remain pending until dismissed. They must
    // never keep the connection lock held or delay disconnect/cleanup.
    void vscode.window.showErrorMessage(message, 'Show Log').then(action => {
      if (action === 'Show Log') output.show(true);
    });
  };
  const createClient = token => new ControlClient(
    vscode.workspace.getConfiguration('tempest').get('cliPath', 'tempest'), prompt => showPrompt(prompt, token),
    { onTrace: message => output.appendLine(message) },
  );
  const withConnectionProgress = (title, client, cancellation, task) =>
    vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: true },
      async (progress, token) => {
        const subscription = token.onCancellationRequested(() => {
          cancellation.cancel();
          client.cancel();
        });
        try {
          progress.report({ message: 'Waiting for Tempest CLI…' });
          return await task();
        } finally {
          subscription.dispose();
        }
      });
  context.subscriptions.push(vscode.commands.registerCommand('tempest.settings', () =>
    vscode.commands.executeCommand('workbench.action.openSettings', '@id:tempest.cliPath')));
  context.subscriptions.push({ dispose() { for (const client of clients) client.dispose(); } });
  context.subscriptions.push(vscode.commands.registerCommand('tempest.connect', async () => {
    if (connecting) {
      output.appendLine('A Tempest connection is already in progress.');
      return;
    }
    connecting = true;
    let client;
    const cancellation = new vscode.CancellationTokenSource();
    try {
      client = createClient(cancellation.token);
      clients.add(client);
      const servers = await withConnectionProgress('Tempest: Loading servers', client, cancellation, async () => {
        const capabilities = await client.request('capabilities');
        if (capabilities?.protocol !== 1) {
          throw new Error('Tempest remote protocol v1 is required.');
        }
        return client.request('servers.list');
      });
      if (!Array.isArray(servers) || !servers.every(server =>
        typeof server.id === 'string' && typeof server.label === 'string')) {
        throw new Error('Invalid server list from Tempest CLI.');
      }
      const server = await vscode.window.showQuickPick(servers, { title: 'Connect to a Tempest server' });
      if (!server) return;
      const folder = await vscode.window.showInputBox({
        title: 'Remote folder', prompt: 'Absolute path on the remote server', value: '/',
        validateInput: value => value.startsWith('/') && !/[\x00-\x1f]/.test(value)
          ? undefined : 'Enter an absolute remote path.',
      });
      if (folder === undefined) return;
      // Control owns authentication and the tunnel. OpenSSH starts the generated
      // ProxyCommand and attaches its SSH byte pipe to that same control.
      const configFile = vscode.workspace.getConfiguration('remote.SSH').get('configFile');
      const remote = await withConnectionProgress(`Tempest: Connecting to ${server.label}`, client, cancellation, () =>
        client.request('remote.ensure', { serverId: server.id, configFile }));
      if (!isSshHost(remote?.sshHost) ||
          !/^[a-f0-9]{64}$/.test(remote?.sessionId || '')) {
        throw new Error('Invalid remote SSH host alias.');
      }
      await context.globalState.update(`remote.${remote.sshHost}`, { serverId: server.id });
      const uri = vscode.Uri.from({ scheme: 'vscode-remote',
        authority: `ssh-remote+${remote.sshHost}`, path: folder });
      await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
    } catch (error) {
      reportError(error);
    } finally {
      cancellation.cancel();
      cancellation.dispose();
      client?.dispose();
      if (client) clients.delete(client);
      connecting = false;
    }
  }));
  // Like Coder, use Remote-SSH's API context to read the authority before
  // folder resolution. The proposed env field is unavailable in our own context.
  // Fall back to public folder URIs when the editor does not expose it.
  let authority;
  const remoteSsh = vscode.extensions.getExtension('anysphere.remote-ssh')
    || vscode.extensions.getExtension('ms-vscode-remote.remote-ssh');
  if (remoteSsh) {
    try {
      const remoteApi = createRequire(path.join(remoteSsh.extensionPath, 'package.json'))('vscode');
      authority = remoteApi.env.remoteAuthority;
    } catch { /* Folder URI fallback below. */ }
  }
  authority ||= vscode.workspace.workspaceFolders?.find(folder =>
    folder.uri.authority.startsWith('ssh-remote+tempest-'))?.uri.authority;
  if (authority?.startsWith('ssh-remote+tempest-')) {
    const host = authority.slice('ssh-remote+'.length);
    const saved = context.globalState.get(`remote.${host}`);
    if (saved && isSshHost(host)) {
      const cancellation = new vscode.CancellationTokenSource();
      const client = createClient(cancellation.token);
      clients.add(client);
      try {
        const remote = await withConnectionProgress('Tempest: Reconnecting to saved server', client, cancellation, async () => {
          const capabilities = await client.request('capabilities');
          if (capabilities?.protocol !== 1) {
            throw new Error('Tempest remote protocol v1 is required.');
          }
          const configFile = vscode.workspace.getConfiguration('remote.SSH').get('configFile');
          return client.request('remote.ensure', { serverId: saved.serverId, configFile });
        });
        if (remote?.sshHost !== host || !/^[a-f0-9]{64}$/.test(remote?.sessionId || '')) {
          throw new Error('Tempest remote identity changed.');
        }
      } catch (error) {
        reportError(error);
        await vscode.commands.executeCommand('workbench.action.remote.close');
      } finally {
        cancellation.cancel();
        cancellation.dispose();
        client.dispose();
        clients.delete(client);
      }
    }
  }
}
module.exports = { activate };
