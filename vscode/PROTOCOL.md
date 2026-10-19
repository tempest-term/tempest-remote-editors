# Tempest remote control protocol v1

Implemented by `tempest remote control --protocol 1` in this checkout.

The local UI extension launches `tempest remote control --protocol 1` without
shell interpolation. stdin/stdout carry UTF-8 newline-delimited JSON only.
SSH traffic never shares this pipe. Secrets are never passed in argv or logged.
The CLI owns vault unlock, account access and all remote credentials.

## Requests

Every request has `{ "type": "request", "id": "1", "method": "…", "params": {} }`.
Responses echo the id: `{ "type": "response", "id": "1", "result": … }`.
Failures use `error: { code, message }`; messages must never contain secrets.

- `capabilities`: returns `{ "protocol": 1 }`.
- `servers.list`: returns SSH servers as `[{ "id": "opaque-vault-id", "label": "Production" }]`.
- `remote.ensure`, params `{ "serverId": "opaque-vault-id", "configFile": "/absolute/ssh/config" }`: authenticates
  the remote connection, starts/reuses the independent daemon and prepares its
  SSH config, then returns `{ "sshHost": "tempest-<stable-safe-id>" }`.
  Return only after the remote and managed SSH entry are usable.

## Interactive prompts

The CLI can send prompts while a request is pending:

```json
{"type":"prompt","id":"p1","kind":"password","message":"Private key passphrase"}
{"type":"prompt_response","id":"p1","value":"user input"}
```

Kinds: `password` (hidden input), `text` (e.g. OTP), `confirm` (true means
explicit trust), `select` (includes `choices: [{ "id": "a", "label": "Account A" }]`).
Cancellation returns `{ "type": "prompt_response", "id": "p1", "cancelled": true }`.
The CLI must abort the affected authentication/request on cancellation.
Fingerprint prompts must identify the target, key type, fingerprint, and whether
this is a new or changed key. Never default to trusting a changed key.

## Daemon requirements

- Bind only to loopback; random available port. Require a generated local client
  key, not unauthenticated loopback access. Keep private key material in restricted files.
- Use a stable server alias and pinned remote host key. Do not disable host-key
  verification. CLI verifies the upstream host through existing Rust callbacks.
- Manage a dedicated SSH config and an idempotent Include in the effective
  Remote-SSH config. Custom config paths are supported;
  the extension passes `remote.SSH.configFile` when configured.
- Relay SSH exec, shell, stdin EOF, stdout/stderr, exit status, PTY resizing and
  direct-tcpip channels (including Remote-SSH dynamic forwarding). Account for
  additional connections during bootstrap, reconnect and concurrent windows.
- Control-client exit cancels unfinished requests/prompts. Already established
  daemons survive extension/window reload; never tie them to extension PID.
- Use active SSH connection counts and an idle grace period for cleanup. Stable
  aliases must be reconstructible when reopening recent remote folders.
- Implement Rust remote transport in CLI/core, keeping secrets outside the
  desktop backend. No Tempest desktop process needs to run.

## Implemented scope and validation

Local public-key authentication, upstream Tempest authentication, SSH exec/shell,
PTY requests/resizing, input EOF, stdout/stderr, exit status and direct-tcpip are
implemented. Request/prompt ids, frame sizes, channels and connections are bounded.
File locks serialize setup; private files are replaced atomically. Account, vault
and saved-server ids form the stable alias identity. Cancellation has a distinct
`cancelled` error code. Other errors carry a generic message to avoid leaking
credentials from transport diagnostics.

The current CLI lists servers for its selected account. Server ids are opaque to
the extension and retain their account/vault scope for recent-folder reopening.
The daemon exits after five idle minutes. A dropped upstream session is not
silently replayed; reopening the folder establishes a fresh remote.

The macOS loopback SSH relay and forwarding live test passed. VS Code loaded
the extension and displayed the saved-server picker; full Remote-SSH bootstrap
is blocked by the selected account's native portForwarding entitlement check.
Linux/Windows live verification is outstanding.
Socket-listen mode, remote forwarding and SFTP are outside this initial scope.
Do not publish before live bootstrap, interactive auth, reconnect, large/binary
streams and simultaneous-window tests pass.
