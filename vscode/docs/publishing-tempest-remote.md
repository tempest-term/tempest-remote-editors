---
description: >-
  Prepare, package and upload the MIT-licensed Tempest Remote VS Code extension
  using the AltasExpressLLC Marketplace publisher.
---

# Package & Publish Tempest Remote

The extension is maintained in the **`tempest-vscode`** project, beside `tempest-desktop`. Its Marketplace package identity is **`AltasExpressLLC.tempest-remote`**.

## Package metadata

| Field | Value |
| --- | --- |
| `displayName` | `Tempest Remote` |
| `name` | `tempest-remote` |
| `publisher` | `AltasExpressLLC` |
| `license` | `MIT` |
| Extension version | `3.17.3` |
| CLI command | `tempest remote control --protocol 1` |
| Official CLI download page | `https://gotempest.app/download` |

The MIT license applies to the extension project. The accompanying Tempest CLI/Rust code keeps its own license. The extension package invokes the CLI and does not include that native binary.

## Prepare a release

1. Verify that the CLI available through the official download channel supports `tempest remote control --protocol 1` and `tempest remote pipe`. Check both commands and the capabilities response in the executable intended for the first release.
2. Set the extension version in `package.json` (currently `3.17.3`) and update `CHANGELOG.md`. Choose a new version for each Marketplace upload; an existing version cannot be replaced.
3. Ensure README installation and troubleshooting instructions match the released CLI, not temporary developer paths.
4. Check that `LICENSE` and `license: "MIT"` are present.
5. Validate remote bootstrap, interactive authentication, reconnect, window closure, multiple windows and custom SSH configs on the supported platforms. Loopback tests alone do not prove Remote - SSH bootstrap on every platform.

## Test and package

From the extension project:

```bash
npm ci
npm test
npm run check
npm run package
```

To include the real CLI control test, set `TEMPEST_TEST_CLI` to the CLI executable when running tests. There are no extension runtime dependencies to bundle.

The package script uses `@vscode/vsce` and creates:

```text
tempest-remote-<version>.vsix
```

For `3.17.3`, the file is `tempest-remote-3.17.3.vsix` in the project root. A VSIX is a snapshot: editing source files or metadata after packaging requires packaging again.

The archive should contain the extension manifest, JavaScript source, README, changelog and MIT license. It should exclude tests, local debug configuration and credential files. Do not include account/vault data or a developer's personal CLI settings.

## Test the package in an ordinary VS Code window

Run **Extensions: Install from VSIX...** and select the newly created package. Check the remote indicator menu for **Tempest: Connect to Server**, then test a saved server.

This is different from F5 source testing. A package installed in an ordinary window is what Marketplace users receive.

## GitLab CI automated publishing

The repository's `.gitlab-ci.yml` runs tests and builds a downloadable VSIX for branch and merge-request pipelines. A release tag such as `v3.17.4` additionally publishes that exact build artifact to the VS Code Marketplace. The tag must match `package.json`; mismatches fail before packaging. Publication is serialized, and an existing Marketplace version remains an error rather than being silently skipped.

The pipeline uses a runner with the **Docker executor** and the `docker` tag. All jobs run in the `node:22-bookworm` image, which provides Node.js 22 and npm; the runner host does not need Node installed. Docker-in-Docker and privileged mode are not needed. `@vscode/vsce` is pinned in development dependencies and installed with `npm ci` using the committed lockfile.

One-time Entra setup for this GitLab project:

1. Register the single-tenant application **Tempest Remote GitLab Publisher** in the chosen Entra directory. Record its Application (client) ID and Directory (tenant) ID. No Azure subscription role or Graph API permission is required for this publishing flow.
2. In **Certificates & secrets → Client secrets**, create a publishing client secret with a finite expiration. Copy its **Value**, not its Secret ID. The Value is displayed only at creation; create the credential and transfer it directly to GitLab rather than posting it in chat or committing it.
3. Add protected GitLab CI/CD variables `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET`, scoped to environment `vscode-marketplace`. Set the secret to **Masked and hidden**, with expansion disabled. The tenant and client IDs are not secrets. Rotate the secret before its expiration.
4. Protect `v*` and the `entra-auth-check*` verification tags, allowing Maintainers to create them.
5. Run a protected identity-check tag pipeline. The `verify-marketplace-identity` job authenticates with Entra and prints the identity's Marketplace profile ID, without publishing an extension. Add that identity to publisher `AltasExpressLLC` with the **Contributor** role in Marketplace publisher management. Contributor applies to the publisher, including its extensions, rather than only one VSIX.
6. Confirm publisher membership before creating a release tag. The verification job proves identity authentication; publication additionally requires the Contributor grant.

Setup validation on 2026-10-10: protected tag `entra-auth-check-3` (pipeline `5401`, job `33286`) successfully authenticated with Entra and resolved the Marketplace profile. Publisher management confirmed the application's service principal as a Contributor. This check did not publish a release. Credential rotation was completed and revalidated with `entra-auth-check-4` (pipeline `5403`, job `33291`): tests, VSIX packaging and identity authentication passed after the old Entra secret was revoked. The current secret expires on 2027-04-08. GitLab's UI cannot edit a hidden variable's value; rotation through that UI requires deleting and recreating `AZURE_CLIENT_SECRET` with the same protected, masked/hidden and environment-scope settings, then revoking the old Entra secret and rerunning the identity check.

This deployment uses an Entra client secret because its GitLab issuer resolves to private address `192.168.2.217`. Azure cannot access its OIDC discovery and public-key endpoints, and federation validation returned `AADSTS501661`. The publishing jobs therefore do not request GitLab ID tokens or depend on public GitLab access. The previously created federated credential and project subject configuration are not used by this client-secret flow.

The Node publisher helper uses `ClientSecretCredential` to obtain a short-lived Azure DevOps access token and passes it to the `vsce` API in memory. Neither credential is passed in command arguments or printed. Safe diagnostics expose only error codes; publisher tooling and tests are excluded from the VSIX.

Release a new version after updating `package.json` and `CHANGELOG.md`:

```bash
npm ci
npm test
npm run check
npm run package
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: release Tempest Remote 3.17.4"
git push origin main
git tag v3.17.4
git push origin v3.17.4
```

The example assumes the package version was changed to `3.17.4`; choose the next unused Marketplace version. Download the VSIX from `package-extension` job artifacts. Ordinary branch pushes build packages without publishing. The optional real-CLI test runs only when `TEMPEST_TEST_CLI` points to a compatible installed CLI on the runner; CI does not bundle the native CLI. The dedicated identity-check tag never invokes the publish API.

References: [GitLab OIDC network prerequisites](https://docs.gitlab.com/ci/cloud_services/azure/), and [VS Code Entra publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace).

## Upload to Marketplace

VS Code supports uploading a packaged VSIX directly through its [publisher management page](https://marketplace.visualstudio.com/manage), as described in the [official publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

1. Sign in with the Microsoft account that owns or can publish under **Altas Express LLC**.
2. Select the publisher whose **ID is `AltasExpressLLC`**. The display name is not the package identifier.
3. For a new listing, choose **New extension → Visual Studio Code** and upload the VSIX. For an existing listing, use its update/upload action.
4. Review the listing, version, included README and license before completing publication.

Publisher IDs must match the `publisher` field inside the package. If the ID or content is changed, rebuild the VSIX before uploading. Each subsequent update needs a newer version.

Creating the package, installing it locally and publishing it to Marketplace are separate actions. Packaging does not create a public listing. Keep credentials for automated publishing out of the repository and VSIX.

## MIT or Apache-2.0?

This extension uses [MIT](https://opensource.org/license/mit): it permits modification and redistribution while requiring the copyright and permission notice to be retained.

[Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) also permits broad reuse and explicitly addresses contributor patent grants and patent-license termination. It has additional redistribution and notice provisions. MIT was selected for this relatively small editor/CLI integration; that choice does not change the license of separate Tempest products.

## See also

- [Tempest Remote user guide](https://docs.gotempest.app/connect-to-servers/tempest-remote-vscode)
- [Architecture and control protocol](tempest-remote-architecture.md)
