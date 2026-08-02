# Local Draw.io Runtime Notices

This notice applies to the optional, user-installed local Draw.io runtime. It
does not change Specline's own MIT license.

## Upstream works

The locked runtime uses these unmodified upstream artifacts:

- **draw.io webapp 31.1.2** (`draw.war`), from
  <https://github.com/jgraph/drawio/releases/tag/v31.1.2>, licensed under the
  Apache License, Version 2.0. The upstream license text is
  <https://raw.githubusercontent.com/jgraph/drawio/v31.1.2/LICENSE>.
- **Next AI Draw.io MCP server 0.2.3**
  (`@next-ai-drawio/mcp-server`), from
  <https://github.com/DayuanJiang/next-ai-draw-io> at commit
  `4b072283202d3fe4869acd847ee897ad1165d73d`, licensed under the Apache
  License, Version 2.0. The upstream license text is
  <https://raw.githubusercontent.com/DayuanJiang/next-ai-draw-io/4b072283202d3fe4869acd847ee897ad1165d73d/LICENSE>.

Each distributed runtime copy MUST include `LICENSE.drawio` and
`LICENSE.next-ai-drawio`. These are the complete Apache License 2.0 texts from
the locked upstream revisions and apply respectively to draw.io webapp 31.1.2
and Next AI Draw.io MCP server 0.2.3. The latter also retains the upstream
`Copyright 2024 Dayuan Jiang` attribution. Apache-2.0 permits use,
reproduction, distribution, and derivative modification subject to its
conditions. A redistributor MUST:

1. give every recipient a copy of Apache License 2.0;
2. retain applicable copyright, patent, trademark, and attribution notices;
3. retain applicable upstream NOTICE contents when an upstream distribution
   includes them; and
4. prominently state which distributed files were modified.

The audited archives contain no upstream `NOTICE` file. This does not remove
the license-copy, attribution, or modified-file duties. Apache-2.0 does not
require a source offer for these works.

## draw.io bundled assets and marks

The draw.io archive includes separately noticed icon sets, stencil libraries,
templates, shapes, and third-party components. Preserve the bundled license
files at `img/LICENSE`, `js/libavoid-js/LICENSE`, `shapes/LICENSE`,
`stencils/LICENSE`, and `templates/LICENSE`.

Do not extract or redistribute bundled icon sets or stencil libraries for
incorporation into Atlassian products or the Atlassian Marketplace without
explicit permission. Do not imply affiliation with or endorsement by
draw.io, and do not use draw.io names or logos as Specline branding.

## Prominent modification notice

**Specline modification and integration boundary, Task 11 (2026-08-01):** the
runtime distribution includes the Specline-created release input
`core/runtimes/drawio/patches/launcher.mjs` in addition to the unmodified
locked upstream archives. Specline added that launcher and the following
Specline-owned integration files to replace or restrict unsafe upstream
boundaries:

- `core/runtimes/drawio/patches/launcher.mjs`
- `lib/diagram/runtime.mjs`
- `lib/diagram/mcp-wrapper.mjs`
- `lib/diagram/http-server.mjs`
- `lib/diagram/browser-sync.mjs`
- `lib/diagram/lifecycle.mjs`

The launcher is a distinct Specline modification/release input, not an
unmodified upstream file. Its current implementation requires the session ID,
loopback bridge origin, in-memory bridge token, and fixed MCP entry path;
rejects origins other than credential-free HTTP on `127.0.0.1`; verifies the
fixed entry exists; derives session-scoped authorization environment values;
removes the raw token environment variable; sets the fixed local Draw.io base
URL; and imports the verified MCP entry. The token remains process-memory-only
and is not placed in a URL, argv, state file, artifact, stdout, or stderr.

Task 11 production remediation is complete and test-verified. Together with
the Specline-owned wrapper/runtime, this launcher provides fixed-entry launch,
managed-path and sealed provider-neutral operations, per-session process and
state isolation, loopback session authorization, authenticated same-origin
bridge access, browser revision synchronization, truthful save/export, and
owned lifecycle cleanup. These protections are Specline additions; the
original upstream behavior remains materially different: `start_session` uses
a `localhost` URL, load/export accept arbitrary paths, the bridge lacks
Specline per-session bearer checks, and MCP state is single-active-session per
process. The release gate prevents those upstream boundaries from being
exposed directly.

No source file inside the locked draw.io webapp or Next AI Draw.io MCP archive
is currently modified in place. If a future distribution modifies an upstream
Apache-2.0 file, that file must carry its own prominent change notice and this
NOTICE must be updated. This section is the prominent attribution for the
actual Specline launcher and integration inputs currently intended for the
runtime distribution.

## Release status

The upstream audit is `verified-with-required-mitigations`; it established
provenance and the feasibility of required mitigations but was not a final
release decision. Task 10's immutable dependency closure, atomic installer,
and packaged LICENSE/NOTICE/patch inputs are complete and test-verified. Task
11's production wrapper, launcher, authentication, managed-path/interface
sealing, session isolation, browser synchronization, and lifecycle remediation
are also complete and test-verified.

The current manifest is `releaseVerificationState=verified` and
`releaseGate=true`. The final PKTAP DNS/HTTP/WebSocket no-non-loopback trace
is bound to the canonical `releaseInputDigest` for the packaged production
inputs. No Task 10, Task 11, or Task 12 release remediation remains open.
