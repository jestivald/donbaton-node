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

```sh
npm ci --ignore-scripts --no-audit --no-fund
node --test tests/identity-revocation.test.cjs
npm run typecheck
NODE_ENV=production npm run build
```

The 14 tests invoke the actual service with mocked network/native integrations.
They cover legacy/opt-in paths, single/bulk/rotation, manual IP drops and failed
Xray removals. Existing native modules are retained from the pinned production
image when overlaying dist/main.js. Build in production mode so no hot reload
entry point or local environment values are included.

Runtime base for the first candidate:
`remnawave/node@sha256:0cdf386dd49f360fc885bb34bde21132e478e40f0deac62d616086ec0fa9257e`.
Overlay only xray, main.js, the init script and checksum. Restarting the container
restarts Xray: drain final stats before restart when migrating accounting units.
Quiescing users via the local Xray API leaves the process and counters alive;
resume through Node using current panel membership so its local membership map
is also consistent.
