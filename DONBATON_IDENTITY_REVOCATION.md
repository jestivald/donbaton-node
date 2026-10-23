# Paired VLESS identity revocation

Base: remnawave/node 3.4.1, commit 44912631321664dbd5822e9bf8d96766ccff7c93.

`DONBATON_XRAY_IDENTITY_REVOKE=true` disables automatic source-IP socket drops
after single/bulk user removal and VLESS credential rotation. The normal Xray
RemoveUser calls remain; the paired Xray fork closes that authenticated user's
logical streams. Other values, including an unset flag, preserve upstream
behavior. Explicit operator dropUsersConnections/dropIps keep their behavior.

The init script rejects this mode unless `/usr/local/share/donbaton/identity-core.sha256`
matches `/usr/local/bin/xray` and CUSTOM_CORE_URL is unset. Deploy the reviewed
binary and checksum together. A checksum authenticates the release pairing, not
arbitrary replacement binaries. This mode is scoped to VLESS-only LTE nodes;
other inbound protocols do not have the new core revocation behavior.

The init script also requires `rw-core` to point to the paired stock binary.
`CoreLoaderService` rejects panel `geodata.core` overrides in identity mode and
rechecks the manifest, binary and symlink before a core restart. This validation
runs before replacing Node's active membership/config map. A malformed override,
missing manifest, mismatched hash or custom symlink fails without downloading or
installing another core. Other modes retain upstream custom-core support.

```sh
npm ci --ignore-scripts --no-audit --no-fund
node --test tests/identity-revocation.test.cjs tests/core-loader.identity.test.cjs
npm run typecheck
NODE_ENV=production npm run build
```

The 24 tests invoke the actual services with mocked network/native integrations.
They cover legacy/opt-in paths, single/bulk/rotation, manual IP drops and failed
Xray removals, plus runtime loader pairing and legacy custom-core loading.
Existing native modules are retained from the pinned production
image when overlaying dist/main.js. Build in production mode so no hot reload
entry point or local environment values are included.

Runtime base for the first candidate:
`remnawave/node@sha256:0cdf386dd49f360fc885bb34bde21132e478e40f0deac62d616086ec0fa9257e`.
Overlay only xray, main.js, the init script and checksum. Restarting the container
restarts Xray: drain final stats before restart when migrating accounting units.
Quiescing users via the local Xray API leaves the process and counters alive;
resume through Node using current panel membership so its local membership map
is also consistent.

## 3.4.2 line (2026-10-07)

Branch `codex/identity-stream-revocation-342` merges upstream tag 3.4.2
(`ea7a835485af81ec464ebbf7acaaa7d6dd486a05`) into the 3.4.1 fork without
conflicts. Upstream added the post-start plugin, a shared webhook helper and
@remnawave/xtls-sdk 0.17; `docker/` (including init-env.sh) and the bundled
Xray v26.7.28 are unchanged, so the paired Xray fork binary is reused as is.
Runtime base: `remnawave/node@sha256:1f97485b4bc7e4944f1ae95cc57d176376813b0022e9567b705f384f1a2e909d`.
The overlay must use the base matching package-lock.json, because main.js
keeps node_modules external and loads them from the base image.

## 3.4.3 line (2026-10-23)

Branch `codex/identity-stream-revocation-343` merges upstream tag 3.4.3
(`2ad154f8f1016c94c1872f337268af878af61b18`) into the 3.4.2 fork line without
conflicts. Upstream changed only the package version and the Node.js base of
`docker/Dockerfile` (node:24.20 -> node:24.22, Node.js 24.22.1 security
release); `docker/rootfs` (including init-env.sh), dependencies and the bundled
Xray v26.7.28 are unchanged, so the paired Xray fork binary is reused as is.
The built main.js differs from the 3.4.2 fork build only in the version string.
Runtime base: `remnawave/node@sha256:793f4ac52289f680ea2b12be8047e93f68b710c22ca93b52b9448a6fef7eaaa6`.
