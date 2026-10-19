# Changelog

## 3.17.3 (Unreleased)

- Connect saved SSH servers with local authentication prompts.
- Control establishes the tunnel; OpenSSH ProxyCommands attach by session ID.
- Release the tunnel after the last pipe closes, with bounded handoff and reconnect grace.
- Forward Unix termination signals for each pipe and clean up all pipes when control exits.
- Add cancellable connection progress, settings, connection diagnostics and Remote - SSH menu integration.
- Use the AltasExpressLLC publisher identity and MIT license for the extension.
