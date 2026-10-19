# Tempest Remote Editors

Open saved Tempest SSH servers in VS Code, Cursor, JetBrains and Zed. All integrations reuse the MIT-licensed [Tempest Remote SDK](https://github.com/tempest-term/tempest-remote-sdk) and the local Tempest CLI for accounts, credentials, proxies and jump hosts.

[User guide — all editors and AI clients](https://docs.gotempest.app/integrations/tempest-remote-editors)

## Choose your download

| File | Install in |
| --- | --- |
| `tempest-remote-vscode-3.17.4.vsix` | VS Code: Extensions → Install from VSIX. |
| `tempest-remote-cursor-3.17.4.vsix` | Cursor: Extensions → Install from VSIX. |
| `tempest-remote-jetbrains-3.17.4.zip` | JetBrains: Plugins → Install Plugin from Disk. |
| `tempest-remote-launcher-3.17.4.zip` | Zed / command-line tools: extract and run the launcher below. |

[Downloads](https://github.com/tempest-term/tempest-remote-editors/releases/latest)

## Connect

- **VS Code / Cursor:** choose **Tempest: Connect to Server** in the Command Palette, select a server and enter the remote project folder. VS Code uses Microsoft Remote - SSH; Cursor uses Anysphere Remote SSH.
- **JetBrains:** open **Tempest** in Gateway, select a saved server and click **Continue in Gateway**. In Gateway's native SSH wizard, choose the **Tempest · server-name** connection, then choose the project and IDE. Gateway handles installation, startup, progress and the JetBrains Client. **Advanced settings** only contains Node.js and CLI executable paths.
- **Zed:** the current integration is a standalone launcher, without an in-editor Tempest server picker. From its extracted directory, run:

  ```sh
  node scripts/remote.js connect --server ubuntu-cloudnet --editor zed --folder /home/me/project
  ```

  Keep the launcher running while editing; Ctrl+C releases its attachment.

**Codex** and **Claude Code** have separate Tempest plugins with `remote` and `terminal` skills. After installation, ask the agent to connect your saved server. The skills invoke their helpers; ordinary users do not type those commands. See their sections in the user guide.

## Requirements and authentication

Install and sign in to Tempest CLI locally, with saved SSH servers and remote protocol v1 support. A vault policy allowing TCP forwarding is required. The JetBrains bootstrap passes the CLI’s existing loopback SSH endpoint and local key to Gateway’s native SSH client. It requires a CLI build that returns `remote.ensure.ssh`. Other integrations continue to use OpenSSH ProxyCommand. JetBrains, Zed and the agent helpers need Node.js 18+ locally. The bundled SDK does not require an npm token at installation time.

Passwords, OTPs and host-key confirmations stay in local dialogs or the terminal. Never share secrets in chat. Each integration opens its own SSH attachment. Native editor/server bootstrap must be validated with the installed editor version; a successful SSH probe alone does not verify an editor session. The relay currently lacks SFTP subsystem and Unix-domain socket forwarding.

The VS Code Marketplace identity remains `AltasExpressLLC.tempest-remote`. The former VS Code repository has been superseded by this repository; all editor development and releases are now maintained here.

## Develop

- `vscode/`: VS Code and Cursor extension source and packaging.
- `jetbrains/`: JetBrains plugin and Gateway entry.
- `scripts/`: shared launcher, packaging and version checks.

```sh
npm ci
npm --prefix vscode ci
npm run build
npm run check
npm test
npm --prefix vscode run check
npm --prefix vscode test
npm run package:vscode
npm run package:cursor
npm run package
cd jetbrains
./gradlew buildPlugin
```

Source builds use GitHub Packages for `@tempest-term/remote-sdk` and require `NODE_AUTH_TOKEN` with read:packages. CI uses its repository token. Release downloads include the SDK and its license. All editor packages share one release version.

## License

MIT, copyright Altas Express LLC. Tempest CLI, apps and services have their own licenses and subscription terms.
