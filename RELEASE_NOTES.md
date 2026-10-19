# Tempest Remote 3.17.4

Choose the package for your editor:

- **VS Code:** `tempest-remote-vscode-3.17.4.vsix` — install with Extensions: Install from VSIX.
- **Cursor:** `tempest-remote-cursor-3.17.4.vsix` — install with Extensions: Install from VSIX.
- **JetBrains:** `tempest-remote-jetbrains-3.17.4.zip` — install with Plugins: Install Plugin from Disk.
- **Zed / command-line tools:** `tempest-remote-launcher-3.17.4.zip` — extract and run the Node.js launcher. This also provides an optional Cursor launch command.

All packages use the installed Tempest CLI. The SDK is bundled; no npm registry token is needed to install a download.

The JetBrains plugin is a thin bootstrap: select a saved Tempest server and continue in Gateway's native SSH wizard. Tempest CLI supplies its existing loopback SSH endpoint, local credentials and public host key. Gateway uses native SSH with strict verification of that real endpoint. Tempest CLI owns connection lifetime. Gateway owns project and IDE selection, download, installation, startup, progress and the client.
