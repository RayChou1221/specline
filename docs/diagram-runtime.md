# Local Draw.io Runtime Operations

The local Draw.io runtime is an optional, user-level component for editable
diagrams. It runs the locked draw.io webapp and Next AI Draw.io MCP server
behind Specline-owned path, authentication, network, and lifecycle
boundaries. It has no daemon and no remote fallback.

> **Release gate:** upstream `auditState=verified_with_required_mitigations`
> records provenance and mitigation feasibility; it remains separate from final
> release verification. Task 10–12 remediations are complete, and the final
> PKTAP DNS/HTTP/WebSocket no-non-loopback trace is bound to the canonical
> `releaseInputDigest` with `releaseVerificationState=verified` and
> `releaseGate=true`. Installation, configuration, session start, and MCP
> exposure are permitted only while that bound evidence remains valid.

## Installation plan and consent

Every install, upgrade, reinstall, platform configuration, uninstall, and
multi-session stop begins with a read-only plan. Creating a plan performs no
download, directory creation, process launch, or configuration write.

The plan shows:

- action and a digest tied to the current plan inputs;
- exact draw.io and MCP versions, official source URLs, SHA-256 values, and
  immutable dependency-closure digest;
- download and unpacked byte estimates;
- the user-level target under
  `~/.specline/runtimes/drawio/<runtime-version>/`;
- affected current-platform configuration and sessions;
- the `127.0.0.1` ephemeral-port policy, atomic publish, offline-only policy,
  and absence of automatic upgrades;
- whether one Agent reload is required; and
- the exact uninstall scope and confirmation that diagrams are preserved.

An applying command accepts only the digest of the still-current approved
plan. Any drift requires a new plan and new approval. Refusal or validation
failure causes no planned mutation. Runtime versions never upgrade
automatically.

After the canonical production-input retrace and write-back verification enable the gate, the approved flow is:

```sh
specline diagram plan --action install --json
specline diagram install --approved-plan <approved-digest> --json
```

These examples describe the post-verification contract; while the manifest is
pending/false for the final retrace, they are not authorization to operate.

## Platform configuration and one reload

Only the current platform is proposed by default. Cursor, Claude Code, Codex,
and OpenCode are four independent permission targets. Detecting another
platform does not authorize modifying it. Generate and approve a separate
`configure` plan for every additional platform:

```sh
specline diagram plan --action configure --platform cursor --json
specline diagram configure --platform cursor --approved-plan <approved-digest> --json
```

The first successful configuration for a platform sets
`reloadState=reload_required`. Reload the Agent once. A later invocation that
discovers the MCP clears that state to `reloaded`; if discovery still fails,
the result is `mcp_missing` and the workflow falls back without silently
reinstalling or modifying another platform. Dynamic hot reload is not
promised.

## Session operations

After `releaseVerificationState=verified` and `releaseGate=true`, normal operations use:

```sh
specline diagram start --project <absolute-project-root> --slug <slug> --json
specline diagram status --session <session-id> --json
specline diagram stop --session <session-id> --mode save --json
```

`start` runs health and stale-state checks before creating an isolated session.
Its UI URL must be exactly
`http://127.0.0.1:<ephemeral>/sessions/<session-id>/`. Each session owns a
separate process boundary, HTTP port, in-memory bearer token, revision, and
diagram identity. The token is never placed in the URL, CLI JSON, files,
artifacts, or logs.

`status` is read-only and reports only sessions belonging to the current
project. Stop modes are:

- `save`: synchronize the browser revision, persist, then stop;
- `discard`: stop without persisting this session's uncommitted revision;
- `keep-30m`: hold the session for up to 30 minutes;
- `continue`: leave the session active.

An idle session reaches the 30-minute boundary and attempts synchronization
before owned cleanup. Explicit stop, stdin EOF, `SIGTERM`, and parent-process
exit also clean up the current session idempotently. A synchronization failure
must be reported as not saved.

Stopping all sessions requires a read-only plan listing the exact affected
session IDs and separate approval:

```sh
specline diagram plan --action stop-all --session <id> --json
specline diagram stop-all --approved-plan <approved-digest> --json
```

## Doctor and stale PIDs

The non-mutating diagnostic is:

```sh
specline diagram doctor --json
```

After reviewing its result, stale managed metadata can be repaired with:

```sh
specline diagram doctor --repair-stale --json
```

Doctor verifies the audit/runtime version, manifest and closure digests,
offline layout, platform/reload state, sessions, and stale installer
directories. A PID is classified using its liveness, parent process, process
start time, and session ownership. Repair may remove dead stale records and
old managed staging directories; it must not signal an unknown, reused, or
ownership-unverified PID.

## Uninstall

Uninstall is blocked while managed sessions are active. It requires a fresh
read-only plan and its exact approved digest:

```sh
specline diagram plan --action uninstall --json
specline diagram uninstall --approved-plan <approved-digest> --json
```

The approved operation removes only the versioned managed runtime and
recorded `specline-diagram` configuration fragments. It preserves:

- `specline/diagrams/**`;
- `specline/changes/<change>/diagrams/**`;
- companion Markdown, requested SVG exports, and prototypes; and
- unrelated MCP servers and other platform configuration.

Never manually delete a diagram directory as an uninstall procedure.

## Failure and ASCII fallback

Permission refusal, unavailable MCP, offline download failure, checksum or
closure failure, unhealthy runtime, port failure, sync failure, or blocked
release state is recoverable. The calling workflow continues its non-diagram
work and uses an ASCII diagram when a visual explanation is still useful.

The runtime must not be recovered by using Docker, a hosted draw.io/editor,
remote assets, a remote MCP fallback, floating package versions, or a
non-loopback bind. A remote dependency fails closed.

## License and provenance

The locked upstream works are draw.io webapp 31.1.2 and Next AI Draw.io MCP
server 0.2.3 from their official sources. Both are Apache-2.0. Redistribution
must include the Apache-2.0 license copies, retain applicable notices and
attributions, preserve bundled-asset license files and restrictions, and
prominently mark modifications. See
`core/runtimes/drawio/NOTICE.md` for exact provenance, draw.io bundled-asset
restrictions, the Task 11 modification boundary, and the applicable complete
license copies `LICENSE.drawio` and `LICENSE.next-ai-drawio`.
