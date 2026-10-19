# Tempest Remote for VS Code and Cursor

Open saved Tempest SSH servers through your editor's Remote SSH provider. The shared extension uses the [Tempest Remote SDK](https://github.com/tempest-term/tempest-remote-sdk) and local Tempest CLI for accounts, credentials, proxies and jump hosts.

## Install

Download the package matching your editor from [Releases](https://github.com/tempest-term/tempest-remote-editors/releases/latest), then use **Extensions: Install from VSIX…**:

| Editor | Package | Remote provider |
| --- | --- | --- |
| VS Code | `tempest-remote-vscode-3.17.4.vsix` | Microsoft Remote - SSH |
| Cursor | `tempest-remote-cursor-3.17.4.vsix` | Anysphere Remote SSH |

Install the corresponding remote provider in your local editor. The VS Code Marketplace identity is `AltasExpressLLC.tempest-remote`.

## Connect

1. Open the Command Palette or remote indicator.
2. Choose **Tempest: Connect to Server**.
3. Select a saved server and enter an absolute remote project folder.
4. Complete local authentication prompts. The editor opens the remote window and starts its server.

Use **Tempest: Open Settings** to set the CLI executable path when needed. Loading and connecting can be cancelled. Reconnect through Tempest to refresh an expired connection.

Tempest CLI must already be installed and signed in, with remote protocol v1 support. The selected vault must allow TCP forwarding. The Tempest desktop app does not need to remain open. Keep Remote - SSH's Unix-domain socket mode disabled.

## Troubleshooting

**Output → Tempest Remote** reports Tempest setup errors; **Remote - SSH** reports editor-server bootstrap errors. Check the local CLI setting, sign-in state, vault policy and the remote editor's system requirements. Authentication stays local; never send passwords, PINs or OTPs in chat.

## Documentation

- [VS Code](https://docs.gotempest.app/integrations/tempest-remote-editors#vs-code)
- [Cursor](https://docs.gotempest.app/integrations/tempest-remote-editors#cursor)
- [All editor and AI integrations](https://docs.gotempest.app/integrations/tempest-remote-editors)
- [Source](https://github.com/tempest-term/tempest-remote-editors/tree/main/vscode)

## Develop

Run `npm ci`, `npm run check` and `npm test` in this directory. `npm run package` builds the VS Code VSIX; `npm run package:cursor` builds the Cursor variant from the same source. Registry authentication is only needed for source builds; release VSIX files include the SDK.
