# Nibfin Action

Thin official Action packaging for the released [Nibfin Core v0.1.0](https://github.com/taco3064/nibfin/releases/tag/v0.1.0).
Core alone owns authorization, routing, lifecycle, state, Candidate, review and merge decisions.
This repository's proposed Action version is **0.1.0**. Its publication is a
post-merge obligation; source/package tests do not establish a published Action,
external Caller success, a complete Quick Start or platform support certification.

`core-release.json` records Core source `ae64437d072d16ebad1ed119f6f7ab9c6b459e44`,
release ID `424938292`, CD Run `40431041965`/1, archive/manifest/compatibility asset
identities and Core/Workflow content inventories derived from the published manifest.
The producer's historical Action/CLI fields remain unchanged in its immutable manifest.
Our separate `out/action-release-manifest.json` binds this Action's version,
archive hash and maintained source hashes to that mapping. Candidate source has
no invented final commit; CD regenerates the mapping at the protected merged SHA.

## Installation and invocation

Requires Node **22.23.3**, npm **10**, bash, git, network access for pinned public
checkout and locked dependencies, plus a separately prepared **public trusted host**
checkout at `$GITHUB_WORKSPACE/nibfin-host`. The host must implement the released
`entry.mjs` export `configure({core,mode,context})`, with its own committed lockfile.
The caller must check out its approved full host commit with credentials persistence
disabled. Host configuration supplies authenticated source/custody/provider and
member capabilities; this Action neither implements nor provisions that host.
An ordinary hosted runner without these capabilities cannot perform live delivery.
Never check out an untrusted target branch/fork/PR on a credential-bearing runner.

After actual immutable publication, read the release mapping and pin
`taco3064/nibfin-action@` followed by its **full released source SHA**, rather than
`main`, `latest` or a moving major tag. That Action SHA is intentionally not supplied
before merge. Do not deploy the proposed version until its immutable readback exists.
The following step fragment uses a previously verified local Action checkout:

```yaml
- id: lookup
  uses: ./verified-nibfin-action
  with:
    bundle_commit: ae64437d072d16ebad1ed119f6f7ab9c6b459e44
    host_commit: ${{ vars.APPROVED_NIBFIN_HOST_COMMIT }}
    mode: lookup
    input: '{"nibfin_request":"retained-request","nibfin_correlation":"retained-correlation"}'
    read_token: ${{ github.token }}
```

The two opaque values must identify actual retained requests, not commands or grants.
This fragment is not a complete deployable Caller. Use the released Core's
[workflow contract](https://github.com/taco3064/nibfin/blob/ae64437d072d16ebad1ed119f6f7ab9c6b459e44/docs/workflows.md)
and reusable workflow bundle at the same full Core SHA for deployment preparation.

## Inputs and outputs

Required strings: `bundle_commit` must equal the Core SHA above; `host_commit`
is the separately approved lowercase 40-hex host revision; `mode` and `input`
are required. `input` is a JSON object of at most 16,384 UTF-8 bytes, with exactly:

| Mode | JSON keys | Other inputs |
| --- | --- | --- |
| lookup | nibfin_request, nibfin_correlation | read_token optional |
| resolve | nibfin_request, nibfin_correlation, issue | hosted tokens as configured |
| execute / compute | nibfin_request, nibfin_correlation, issue | resolution required |
| wake | event | actual GitHub Issues event projected by Core |
| registration | nibfin_registration, public_key, level | hosted tokens as configured |

Opaque request/correlation/registration/resolution values use 1–80 ASCII letters,
numbers, `_` or `-`. `issue` is a canonical positive decimal **string**, without a
numeric precision conversion. Registration `level` is `repository` or `organization`;
`public_key` is a string at most 8,192 characters (Core validates its actual use).
`resolution`, `read_token` and `host_token` are optional metadata inputs; resolution
is mandatory for execute/compute. Wake accepts `{"event":{}}` as transport input;
the real `GITHUB_EVENT_PATH` supplies the event, not a user-selected executable.
No arbitrary keys, callbacks, entry paths or shell commands are accepted.

Outputs faithfully expose Core `request`, `reason`, `execution_mode`, `status`,
`selected`, `runs_on`, `resolution`, `reference`, `issue`, `response` where produced.
Absent outputs stay absent. `runs_on` is JSON with cumulative labels/optional group,
not an OR list of members. Preserve opaque `request` on unresolved effects and
reconcile it through the trusted host before any retry. Selected/completed stage
statuses and wrapper exit success do not mean an Issue has been delivered.
Raw exceptions, tokens and input/event/provider bodies are never diagnostic output.
Malformed content/transport returns a bounded `invalid-or-unavailable` failure.
Upstream nonzero exit codes remain nonzero; no fallback or automatic retry occurs.

## Permissions and credentials

| Mode | Job GITHUB_TOKEN permissions | Protected host capability |
| --- | --- | --- |
| lookup | contents:read, actions:read, id-token:write | retained request/source read |
| resolve | contents:read, actions:read, id-token:write | Runner Administration:read and custody |
| execute / compute | contents:read, id-token:write | member service account's local gh login |
| wake | contents:read, actions:read, id-token:write | authorized Actions dispatch |
| registration | contents:read, actions:read, id-token:write | Administration:write or separately authorized org registration |

Declare these at the caller job. Never request write-all or inherit all secrets.
`read_token` is a hosted read identity; `host_token` is a separate protected
hosted management identity. Keep management secrets in the protected hosted
environment, never repository-wide secrets or member jobs. Execute/compute do
not receive either hosted input token, GH_TOKEN or GITHUB_TOKEN in Core invocation;
local service-account gh authentication is not replaced by an Actions token.
Host code must preserve those boundaries into agents/hooks and enforce fresh
Grant, Scope, dependency, source and Runner checks. An Assignee or label is not authorization.
Public personal and organization repository ownership share the design; Private
is out of scope. Unmeasured OS/Agent/host combinations remain Unverified; packaging
and source tests do not promote the producer's compatibility classifications.

## Packaging, verification and release

Use `npm ci --ignore-scripts --no-audit --no-fund --bin-links=false`, then provide the fixed released
source at `.test-core` (CI checks out the SHA above). Development checks import
dependencies directly; disabling unused executable links keeps isolated Candidate
workspaces free of symlinks, including ignored dependency directories. Local supplied `/inputs`
source is contract data only. For a fresh local test directory, run
`node tooling/test-input.mjs /inputs` through the guarded runner. It verifies both
approved archives, installs the official package bytes in `.test-core`, and converts
supplemental CRLF fixture/lock text only where the result exactly matches the
published manifest hash. Runtime content verification remains byte-exact.
`node tooling/package.mjs` produces both mandatory
Candidate artifacts. `node tooling/package.mjs --verify` inspects the existing
archive without rebuilding. `npm test` exercises that exact archive through its
metadata-referenced entry with inert host fixtures and actual released Core.
In controlled execution, run dependency/package/consumer checks sequentially via
`node /verification-runner.mjs -- <executable> [arguments...]`.

`Action release` runs only on protected `main` push or main workflow_dispatch,
serializes publication, and verifies an associated merged PR/source through the
GitHub API. Enable repository [release immutability](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes)
before publication. Protect environment `nibfin-release` and provide its
`NIBFIN_RELEASE_TOKEN` with Contents:write and Administration:read for the
[immutable-releases preflight](https://docs.github.com/en/rest/repos/repos#check-if-immutable-releases-are-enabled-for-a-repository).
This token is publication-only, never an Action runtime input. Missing/403
capabilities block the operation; no setting is silently bypassed or enabled.

CD assembles complete assets in a draft, publishes, then reads back immutable
release, tag target, source and exact asset digests/sizes. Matching state is reused;
conflicting tag/release/content is rejected without deletion or overwrite.
On an unknown write, inspect retained `publication-result.json` and provider
state before an authorized rerun; the next run reconciles existing state first.
A skipped/absent/failed CD is incomplete. Completion evidence must include actual
merged source, CD Run/Attempt, release ID/URL, immutable tag and asset identities.
External Caller execution belongs to #9; complete public Quick Start and final
measured mappings belong to their own Issues.

Upgrade by reviewing the new immutable mapping and compatibility, changing pins
under applicable fresh authorization, and preserving unfinished/unknown work.
Never silently replace a Grant-bound Core, runtime or Skills or reuse old Acceptance/CI.
Independent Acceptance, isolated hooks where applicable, exact-head repository CI,
final review and protected merge remain Core-managed gates.
