# Nibfin Action

Thin Action adapter for the reviewed, integrated public Nibfin distribution from
[nibfin #233](https://github.com/taco3064/nibfin/issues/233), with the reviewed
[native Scope/Shape and maintenance candidate](https://github.com/taco3064/nibfin/pull/253), source
`bf64807a364cfeb5f8f19219d2f8d61739106d01`. Core owns authorization, routing,
policy, custody, lifecycle, recovery, independent reviews, scheduling and merge.
The Action supplies no grant, repair capability, retry loop, timer service or second controller.

This is a **source/package candidate**, not a published Action or integrated Core
release. Proposed Action version: **0.1.0**. `core-release.json` binds the reviewed
Core archive (`54719b642430259c1cead603749161b9ec282cdf7f8d19ca3ca25cecfd99f859`),
manifest, compatibility, all installed package files and component/API identities.
The old Core pin `ae64437d072d16ebad1ed119f6f7ab9c6b459e44` is incompatible with
this adapter. Its historical public release does not prove the new integrated
package was released. Action #8's failed publication remains failed historical work.

## Installation boundary

Installation and upgrade remain behind the original `gh nibfin init`,
`runner create`, `runner register`, `runner unregister`, `runner list`,
`runner remove` and `upgrade` journey. The existing protected host integration
prepares the installed package at `$GITHUB_WORKSPACE/nibfin-bundle` and the
separately approved public host at `$GITHUB_WORKSPACE/nibfin-host/host`.
No extra user setup command, second controller installation, private checkout,
maintainer key, manual signing step or fixed maintainer directory is introduced.
The localhost Dashboard remains planned. The adapter requires Node 22.23.3,
npm 10 for locked preparation and bash for composite invocation.

The Action consumes those prepared bytes; it does not execute a participant
checkout, install a service or configure a Runner. Do not check out an untrusted
branch, fork or workflow_run source onto a credential-bearing job. Runtime metadata
has no checkout step and interpolates caller values only into environment variables,
never shell source. Public personal and Organization repositories use the same
current effective permissions, Assignee and independently owned Runner/model-login
checks in Core. Private repositories are outside the product scope.

## Protected embedding contract

`src/invoke.mjs` adapts the shipped source-checkout entry to an **installed archive**.
The producer's source entry assumes `package-lock.json`; the archive instead ships
`npm-shrinkwrap.json`. The adapter validates the full archive inventory before
imports and calls `createInstallation`, the maintained protected host `configure`,
and `createWorkflowEntry` directly. It does not rename a historical checkout or
synthesize a lockfile to satisfy a different loader.

The protected workflow/host supplies these environment values independently of
Action inputs, Issue text and event/display hints:

| Environment | Contract |
| --- | --- |
| NIBFIN_HOST_REPOSITORY | `taco3064/nibfin`, the public maintained host owner, not a participant allowlist |
| NIBFIN_SOURCE_APPROVALS | JSON object with bundle, host, deployment and readiness approvals |
| NIBFIN_HOST_CAPABILITY_SOURCE | Reviewed executable deployment module using the producer's loadProtectedDeployment contract |
| NIBFIN_HOST_OPTIONS | Version 1 mode-bound producer options; repository, repositoryId and environment, plus supported producer options |
| NIBFIN_READINESS_SOURCE | Reviewed module exporting observeCapability and optionally runner |

Bundle approval is `{repository,commit,files}` matching the ordered mapping in
`core-release.json`. Host approval has its **own** full commit and file inventory;
its required `host/*` bytes must match this distribution's dependency-free host.
It is not inferred from the bundle approval or caller-supplied `host_commit`.
Deployment approval is `{sourceSha256,optionsSha256}`. Readiness approval is
`{sourceSha256}`. These are protected deployment snapshots, never self-issued
caller approvals. A hash validates an already approved snapshot; it does not
independently authorize a caller or deployment.

Readiness module callbacks are trusted embedding capabilities, not serialized
caller flags. `observeCapability({capability,version,sha256,signal})` must read the
actual protected installation and return the producer's verified observation.
The Action calls `createInstallation({version:1,expected:{packageVersion:'0.1.0',
coreSha256:<mapped core identity>},profile,observeCapability,runner?}).check()`.
Lookup/resolve/wake/registration/rescue require `source-contract`; execute/compute
require `member-runtime`, including producer runner `configuration`, `observe`
and `probe`. Source readiness never establishes member execution eligibility.
Missing/incompatible runtime, workflow, Skills, source, recovery or job-admission
observations block invocation. Check construction does not register Runners,
install services or invoke the live aborting admission hook. Operational Core
checks still run after readiness.

The producer distribution API mapping is version 1, runtime 2, workflow/Skills/
source/recovery/job-admission/installation/readiness 1. Runtime, workflows, Skills,
source map and package identities travel together. Original responsibilities have
one maintained public owner each:

| Historical responsibility | Public owner called by the installed distribution |
| --- | --- |
| action-identity | src/host-identity.mjs, via protected host configure |
| action-provenance | src/evidence.mjs, for retained receipt source identities; Core enforces fresh stage provenance |
| action-event | src/relay.mjs, through the existing host |
| action-stage | src/workflow.mjs, createWorkflowEntry; lifecycle remains src/runtime.mjs and src/core.mjs |

`src/rescue-policy.mjs` owns recovery Run authentication and `src/rescue-completion.mjs` owns its workflow_run receiver; `src/host-source.mjs` owns deployment source approval. These are distinct producer responsibilities, not wrapper alternatives.

`src/distribution-map.json` records origin/adaptation provenance. Historical Kairo
and maintainer self-hosted transport are provenance, not public runtime prerequisites.

## Inputs and safe outputs

Required inputs: `bundle_commit` (exact reviewed SHA above), `host_commit`
(separately approved full lowercase SHA), `mode`, and `input` (JSON object,
maximum 16,384 UTF-8 bytes). Unknown keys/modes, commands, paths, capability flags
and cancellation targets are rejected. Required JSON keys are exact:

| Mode | JSON keys | Additional input |
| --- | --- | --- |
| lookup | nibfin_request, nibfin_correlation | optional hosted read_token |
| resolve | nibfin_request, nibfin_correlation, issue | optional hosted tokens |
| execute / compute | nibfin_request, nibfin_correlation, issue | retained resolution required |
| wake | event | Core projects the actual GitHub Issue event, ignoring caller event contents |
| registration | nibfin_registration, public_key, level | level repository or organization |
| rescue | request_id, source_run_id, source_attempt, mode, nibfin_correlation, nibfin_issue | mode repair, diagnose or verify; request_id is a retained 64-hex case identity |

Opaque handles contain 1–80 ASCII letters, digits, `_` or `-`. Issue/Run/Attempt
identities are positive canonical decimal strings; no number conversion occurs.
Registration public_key is bounded to 8,192 characters. Core validates provenance,
permissions, retained resolution, Issue/cycle and case/continuation linkage.
Rescue invocations require authenticated workflow_dispatch; workflow_run is
consumed only by the producer's authenticated receiver, never as executable checkout.
No display hint can select work or declare completion.

Outputs project only producer-defined `request`, `reason`, `execution_mode`,
`status`, `selected`, `runs_on`, `resolution`, `reference`, `issue`, `response`,
`outcome`, `conclusion` where present. Absent outputs remain absent. Typed case,
cycle, source and continuation identities remain in producer-owned custody;
the wrapper does not invent replacement identities. Runs-on labels are cumulative,
not alternative member choices. A selected/completed stage or acknowledged dispatch
is not delivered work or successful recovery.

Only producer-verified **RESOLVED** with confirmed reporting and success conclusion
returns successful rescue exit. UNRESOLVED fails. STAGE_RECOVERED, DEFERRED,
PENDING_VERIFICATION, SUPERSEDED and NOT_NEEDED retain neutral conclusions but
fail visibly because the producer's current single-job host cannot report a neutral
final Run. Reporting failures, conflicting/missing/malformed output, nonzero exits,
timeout and cancellation cannot become green or trigger an automatic retry.
The child has the shared 180-minute stage ceiling; cancellation propagates and
its process group is terminated. Intentional holds, finite repair budgets and
uncertain-write reconciliation remain Core-owned.

Raw child stdout/stderr, exceptions, event/input/provider bodies never enter public
logs. The parent validates the file protocol, rejects duplicate/unknown output
fields, and uses producer credential-output matching before publication. Failures
return only bounded `invalid-or-unavailable` diagnostics. Hosted read/management
inputs and GH_TOKEN/GITHUB_TOKEN are removed for execute/compute/rescue. Member
Core uses the actual service account's local gh login; model credentials stay with
the independently owned member environment, outside agents/hooks/untrusted checkout
as required by Core's isolation contract.

Declare least permissions at the caller job: contents:read plus actions:read and
id-token:write where hosted provenance requires them; member jobs need their
protected local login, not management tokens. Runner reads require the host's
appropriate Administration:read; registration requires independently authorized
Repository/Organization administration. Do not use write-all or inherit all secrets.
Assignee, label, login and readiness are not Owner authorization.

## Verification and release definition (#15)

All dependency preparation, packaging and installed-consumer tests in controlled
execution run sequentially through `node /verification-runner.mjs -- <executable>`.
Prepare a writable exact-byte copy with `/verification-prepare.mjs`. In that copy,
`tooling/test-input.mjs <approved-artifact-directory> <reviewed-source-directory>`
verifies all three upstream artifacts, unpacks the exact Core archive and performs
nested `npm ci --ignore-scripts --no-bin-links --no-audit --no-fund` against its
shrinkwrap. It copies hash-checked **test-only** fixture data, rewriting their imports
to installed package bytes. Production code has no tooling-fixture imports.
CI uses `tooling/test-input.mjs --build .test-producer` to reproduce the reviewed archive from its immutable source. `tooling/core-source.json` binds build inputs and accepted tar permission modes (seven package files are private 0600). Only temporary test-input modes change; original source bytes, protected handoffs and archive pins remain exact. All three rebuilt artifact hashes must match the supplied handoff. Then run
`tooling/package.mjs`, `npm test` and `tooling/package.mjs --verify`.

Both mandatory artifacts, `out/nibfin-action.tgz` and
`out/action-release-manifest.json`, bind exact runtime and source bytes. The manifest
has candidate source identity until protected CD binds the actual merged commit.
Dependency caches and temporary consumer directories are test inputs, not deliverables.
Local fixtures exercise real production owners with inert provider/process boundaries;
they do not certify platforms, model logins, native isolation, live GitHub operations,
Marketplace publication, external Caller success or full product completion.

The maintained protected `Action release` workflow implements #15. Before any Action
write, publication now requires an actual immutable **integrated Core release from
#203** with exact tag/source and all three asset digests/sizes matching this mapping.
The historical Core release and #233 source handoff cannot satisfy that gate.
If #203 chooses a new version/reviewed compatible revision, #15 must explicitly
refresh and independently verify the mapping; no pin is silently replaced here.
No live release is performed or required for this source Issue.

CD retains protected main, merged-PR/source readback, immutable-release preflight,
draft asset assembly, exact asset readback, conflict rejection and unknown-write
reconciliation. Protect `nibfin-release` and supply its publication-only
NIBFIN_RELEASE_TOKEN with Contents:write and Administration:read. Missing/denied
capabilities block publication. On an unknown write, retain publication-result.json
and independently reconcile provider state before an authorized rerun. Matching
published state is reused; conflicting releases/tags/assets are never overwritten.
No failed, skipped or unrun publication counts as successful.

Upgrade and rollback use Core's planInstallationTransition/applyInstallationTransition
behind the original CLI boundary: retain conversations, pending work and receipts;
check hold/pause/unknown-write and termination/reconciliation; switch the entire pin
set only at a safe boundary. Changed pins require fresh gates and applicable
reauthorization. They cannot take over unfinished sessions or reuse old Acceptance/CI.
Independent Acceptance, applicable isolated hooks, exact-head CI, final review and
protected merge remain Core-managed obligations after this source handoff.

The current [shared-capacity correction](https://github.com/taco3064/nibfin/pull/257)
keeps Actions Runs, Jobs and logs in each installed project. Member capacity is
independent of project count, such as six slots shared by ten projects. The older
central source/target projection from PR #248 is historical and is rejected by
the official installation path. Repository-scoped ephemeral registration, native
host assembly and live takeover remain separately verified integration work;
the updated producer pin does not certify those capabilities.
