import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  cpSync,
  symlinkSync,
  rmSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { gunzipSync, gzipSync } from 'node:zlib';
import { parse } from 'yaml';
import { pin, hash, verifyCore, project } from '../src/contract.mjs';
import { verifyPackage, inspectArchive, runtimeFiles } from '../tooling/package.mjs';
import {
  root,
  upstream,
  sentinel,
  consumer,
  invoke,
  rescueCall,
} from './action-consumer.mjs';
test('Candidate workspace and dependencies contain no symlinks', () => {
  function scan(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const next = join(path, entry.name);
      assert.equal(entry.isSymbolicLink(), false, next);
      if (entry.isDirectory()) scan(next);
    }
  }
  scan(root);
});
test('package release mapping and real entry modes remain bound', async () => {
  const c = consumer();
  try {
    const m = verifyPackage();
    assert.equal(m.source.kind, 'candidate');
    assert.equal(m.source.commit, null);
    const inputs = c.meta.inputs;
    assert.deepEqual(
      Object.keys(inputs),
      'bundle_commit host_commit mode input resolution read_token host_token'.split(
        ' ',
      ),
    );
    for (const [k, v] of Object.entries(inputs))
      assert.equal(
        v.required,
        !['resolution', 'read_token', 'host_token'].includes(k),
      );
    for (const [k, v] of Object.entries(c.meta.outputs))
      assert.equal(v.value, '${{ steps.entry.outputs.' + k + ' }}');
    for (const s of c.meta.runs.steps) {
      if (s.uses) assert.match(s.uses, /@[a-f0-9]{40}$/);
      if (s.run) assert(!s.run.includes('${{'));
    }
    assert(!c.meta.runs.steps.some((s) => s.uses?.startsWith('actions/checkout')));
    const wired = c.meta.runs.steps.find((s) => s.id === 'entry').env;
    for (const k of ['BUNDLE_COMMIT', 'HOST_COMMIT', 'MODE', 'INPUT', 'RESOLUTION'])
      assert.equal(wired['NIBFIN_' + k], '${{ inputs.' + k.toLowerCase() + ' }}');
    for (const token of ['read_token', 'host_token'])
      assert.equal(
        wired['NIBFIN_' + token.toUpperCase()],
        "${{ inputs.mode != 'execute' && " +
          "inputs.mode != 'compute' && inputs.mode != 'rescue' && inputs." +
          token +
          " || '' }}",
      );
    const { generateKeyPairSync } = await import('node:crypto');
    writeFileSync(
      join(c.dir, 'public.pem'),
      generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({
        format: 'pem',
        type: 'spki',
      }),
    );
    for (const [mode, expected] of [
      ['lookup', 'resolved'],
      ['resolve', 'selected'],
      ['compute', 'completed'],
      ['execute', 'completed'],
      ['wake', 'run-observed'],
      ['registration', 'delivered'],
    ]) {
      const r = invoke(c, mode);
      assert.equal(r.status, 0, mode + ': ' + r.output + r.stderr);
      assert(r.output.includes('status=' + expected + '\n'), mode + ': ' + r.output);
      if (['compute', 'execute'].includes(mode)) {
        assert.deepEqual(r.audit.tokens, []);
        assert(r.output.includes('reference=ref-stage-result'));
      }
      if (mode === 'resolve') {
        assert(r.output.includes('resolution=ref-resolution'));
        assert(r.output.includes('execution_mode=compute'));
        assert(r.output.includes('runs_on='));
      }
      if (mode === 'lookup') assert(r.output.includes('issue=101'));
      if (mode === 'registration')
        assert(r.output.includes('response=ref-registration-result'));
    }
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});
test('Issue/stage metadata reaches entry and safe model progress', () => {
  const c = consumer();
  try {
    const input = {
      nibfin_request: 'request-1',
      nibfin_correlation: 'correlation-1',
      nibfin_issue: '101',
      nibfin_stage: 'shape',
    };
    assert.equal(invoke(c, 'lookup', { input }).status, 0);
    const result = invoke(c, 'compute', { input: { ...input, issue: '101' } });
    assert.equal(result.status, 0, result.output + result.stderr);
    assert.match(result.stdout, /"stage":"shape","status":"running"/);
    for (const changed of [
      { nibfin_issue: '102' },
      { nibfin_stage: 'accept' },
      { nibfin_stage: 'shell' },
    ]) {
      const denied = invoke(c, 'compute', {
        input: { ...input, issue: '101', ...changed },
      });
      assert.notEqual(denied.status, 0);
      assert.equal(denied.audit?.records ?? 0, 0);
    }
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});

test('transport, permission and unknown results fail safely', () => {
  const c = consumer();
  try {
    for (const change of [
      { NIBFIN_MODE: 'shell' },
      { NIBFIN_BUNDLE_COMMIT: 'main' },
      { NIBFIN_BUNDLE_COMMIT: 'a'.repeat(40) },
      { NIBFIN_HOST_COMMIT: 'main' },
      { NIBFIN_INPUT: '{' },
      { NIBFIN_INPUT: '[]' },
      { NIBFIN_INPUT: '{}' },
      { NIBFIN_INPUT: 'x'.repeat(16385) },
      {
        NIBFIN_INPUT:
          '{"nibfin_request":"x","nibfin_correlation":"x","command":"echo SECRET"}',
      },
      { NIBFIN_INPUT: '{"nibfin_request":1,"nibfin_correlation":"x"}' },
    ]) {
      const r = invoke(c, 'lookup', { change });
      assert.notEqual(r.status, 0);
      assert.equal(r.audit, null);
      assert(!r.output.includes('SECRET'));
    }
    for (const change of [
      { NIBFIN_RESOLUTION: '' },
      { NIBFIN_RESOLUTION: 'x\ny=z' },
    ]) {
      const r = invoke(c, 'compute', { change });
      assert.notEqual(r.status, 0);
      assert.equal(r.audit, null);
    }
    for (const mode of ['resolve', 'compute', 'execute', 'registration', 'wake']) {
      const r = invoke(c, mode, { input: {} });
      assert.notEqual(r.status, 0);
      assert.equal(r.audit, null);
    }
    for (const issue of [1, '01', '0', '1\nfoo=bar']) {
      const r = invoke(c, 'resolve', {
        input: { issue, nibfin_request: 'a', nibfin_correlation: 'b' },
      });
      assert.notEqual(r.status, 0);
      assert.equal(r.audit, null);
    }
    for (const fault of [
      'unavailable',
      'missing-auth',
      'denied-auth',
      'permission',
      'newline',
    ]) {
      const r = invoke(c, fault === 'permission' ? 'resolve' : 'lookup', { fault });
      assert.notEqual(r.status, 0);
      assert(r.output.includes('status=blocked'));
      assert.equal(r.audit.records, 0);
    }
    const r = invoke(c, 'compute', { fault: 'unknown' });
    assert.notEqual(r.status, 0);
    assert(r.output.includes('status=unresolved'));
    assert(r.output.includes('request=request-1'));
    assert.equal(r.audit.records, 1);
    writeFileSync(
      join(c.dir, 'nibfin-bundle/src/workflow-entry.mjs'),
      'throw Error("changed")',
    );
    const wrong = invoke(c, 'lookup');
    assert.notEqual(wrong.status, 0);
    assert.equal(wrong.audit, null);
    for (const s of [
      'status=resolved\ninjected=yes\n',
      'status=resolved\nstatus=completed\n',
      'status=resolved\nreference=x\rfoo=y\n',
      'status=resolved\nreference=bad value\n',
      'status=resolved\nrequest=' + 'a'.repeat(81) + '\n',
    ])
      assert.throws(() => project(s));
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});
test('archive alterations and symlinks fail closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nibfin-package-'));
  try {
    for (const file of [
      ...runtimeFiles,
      'out/nibfin-action.tgz',
      'out/action-release-manifest.json',
      ...verifyPackage().source.files.map((f) => f.path),
    ]) {
      mkdirSync(join(dir, file, '..'), { recursive: true });
      cpSync(file, join(dir, file));
    }
    const original = readFileSync(join(dir, 'out/action-release-manifest.json'));
    for (const mutate of [
      (m) => (m.format = 2),
      (m) => (m.package = 'wrong'),
      (m) => (m.version = '9.0.0'),
      (m) => (m.core.commit = 'main'),
      (m) => (m.core.status = 'published'),
      (m) => (m.archive.sha256 = '0'.repeat(64)),
      (m) => (m.source.commit = 'a'.repeat(40)),
    ]) {
      const m = JSON.parse(original);
      mutate(m);
      writeFileSync(join(dir, 'out/action-release-manifest.json'), JSON.stringify(m));
      assert.throws(() => verifyPackage(dir));
    }
    writeFileSync(join(dir, 'out/action-release-manifest.json'), original);
    writeFileSync(join(dir, 'src/entry.mjs'), 'changed');
    assert.throws(() => verifyPackage(dir));
    const bytes = readFileSync('out/nibfin-action.tgz');
    for (const attack of [
      (h) => {
        h.fill(0, 0, 100);
        h.write('../action.yml');
      },
      (h) => {
        h[156] = 50;
        h.write('/tmp/unsafe', 157);
      },
    ]) {
      const tar = gunzipSync(bytes),
        h = tar.subarray(0, 512);
      attack(h);
      h.fill(32, 148, 156);
      let sum = 0;
      for (const b of h) sum += b;
      h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
      assert.throws(() => inspectArchive(gzipSync(tar), runtimeFiles));
    }
    assert.throws(() => inspectArchive(bytes, [...runtimeFiles, 'missing']));
    assert.throws(() => inspectArchive(bytes, runtimeFiles.slice(1)));
    rmSync(join(dir, 'src/entry.mjs'));
    symlinkSync(join(root, 'src/entry.mjs'), join(dir, 'src/entry.mjs'));
    assert.throws(() => verifyPackage(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rescue binds completion; dispatch alone never resolves', async () => {
  const c = consumer();
  try {
    for (const [scenario, outcome, code] of [
      ['resolved', 'RESOLVED', 0],
      ['unresolved', 'UNRESOLVED', 1],
      ['unsupported', 'UNRESOLVED', 1],
      ['stage-recovered', 'STAGE_RECOVERED', 1],
      ['deferred', 'DEFERRED', 1],
      ['pending', 'PENDING_VERIFICATION', 1],
      ['superseded', 'SUPERSEDED', 1],
      ['not-needed', 'NOT_NEEDED', 1],
    ]) {
      const r = await rescueCall(c, scenario);
      assert.equal(r.status, code, scenario + ': ' + r.output + r.stderr);
      const report = Object.fromEntries(
        r.output
          .trim()
          .split('\n')
          .map((line) => {
            const at = line.indexOf('=');
            return [line.slice(0, at), line.slice(at + 1)];
          }),
      );
      assert.deepEqual(
        Object.fromEntries(
          ['status', 'outcome', 'conclusion', 'reason'].map((k) => [k, report[k]]),
        ),
        {
          status:
            outcome === 'RESOLVED'
              ? 'resolved'
              : outcome === 'UNRESOLVED'
                ? 'unresolved'
                : 'blocked',
          outcome,
          conclusion:
            outcome === 'RESOLVED'
              ? 'success'
              : outcome === 'UNRESOLVED'
                ? 'failure'
                : 'neutral',
          reason:
            outcome === 'RESOLVED' || outcome === 'UNRESOLVED'
              ? 'verified-report'
              : 'reporting-unsupported',
        },
        scenario,
      );
      assert.equal(report.issue, '101');
      assert.equal(report.stage, 'deliver');
      assert.equal(report.verified, outcome === 'RESOLVED' ? 'true' : 'false');
      assert.match(r.stdout, /Nibfin execution /);
      assert.deepEqual(r.audit.tokens, []);
      assert.equal(r.audit.target.cycle, 'cycle-1');
      assert.equal(r.audit.state.cases[r.audit.id].source.runId, '100');
      assert.equal(r.audit.state.cases[r.audit.id].source.attempt, '1');
      if (scenario === 'pending') {
        assert.equal(r.audit.repairs, 1);
        assert.equal(r.audit.diagnoses, 1);
        assert.equal(report.root_cause, 'Invocation failure');
        assert.equal(report.repair_status, 'pending-verification');
        assert.deepEqual(r.audit.dispatches, [1]);
        assert.equal(
          r.audit.state.cases[r.audit.id].continuation.outcome,
          'confirmed-success',
        );
      }
    }
    for (const scenario of [
      'stale-cycle',
      'ambiguous-completion',
      'cancelled',
      'unknown-write',
      'paused',
      'hold',
      'budget',
      'forged-workflow-run',
      'provenance-actor',
      'provenance-attempt',
      'provenance-workflow',
      'provenance-repository',
      'provenance-version',
    ]) {
      const r = await rescueCall(c, scenario);
      assert.notEqual(r.status, 0, scenario);
      assert(!r.output.includes('conclusion=success'), scenario);
      assert(r.audit.repairs <= 1, scenario);
      assert(r.audit.diagnoses <= 1, scenario);
      if (
        scenario.startsWith('provenance-') ||
        [
          'cancelled',
          'unknown-write',
          'paused',
          'hold',
          'forged-workflow-run',
        ].includes(scenario)
      )
        assert.equal(r.audit.repairs, 0, scenario);
    }
    for (const inputChange of [
      { command: 'shell' },
      { cancel_run: '123' },
      { display_outcome: 'RESOLVED' },
      { source_attempt: '2' },
      { source_run_id: '101' },
      { nibfin_issue: '102' },
      { request_id: 'a'.repeat(64) },
    ]) {
      const r = await rescueCall(c, 'pending', { inputChange });
      assert.notEqual(r.status, 0);
      assert(!r.output.includes('conclusion=success'));
      assert.equal(r.audit?.repairs ?? 0, 0);
    }
    const wrongEvent = await rescueCall(c, 'pending', {
      change: { GITHUB_EVENT_NAME: 'workflow_run' },
    });
    assert.notEqual(wrongEvent.status, 0);
    assert.equal(wrongEvent.audit.repairs, 0);
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});
test('continuation preserves completion and exact-head observations', async () => {
  const c = consumer();
  try {
    const early = await rescueCall(c, 'early-completion');
    assert.equal(early.status, 0, early.output);
    assert(early.output.includes('outcome=RESOLVED'));
    assert.equal(early.audit.observed.deferred, 'DEFERRED');
    assert(early.audit.observed.now < early.audit.observed.deadline);
    assert.equal(early.audit.repairs, 0);
    const unchanged = await rescueCall(c, 'unchanged');
    assert.notEqual(unchanged.status, 0);
    assert.equal(unchanged.audit.observed.next, 'UNCHANGED');
    assert.equal(unchanged.audit.observed.before, unchanged.audit.observed.after);
    const changed = await rescueCall(c, 'ci-change');
    assert.notEqual(changed.status, 0);
    assert(changed.output.includes('outcome=PENDING_VERIFICATION'));
    assert.equal(changed.audit.observed.proof.kind, 'ci-change');
    assert.equal(changed.audit.observed.unchangedAccepted, false);
    assert.equal(changed.audit.observed.foreignAccepted, false);
    assert.equal(changed.audit.repairs, 1);
    assert.equal(changed.audit.diagnoses, 1);
    assert.deepEqual(changed.audit.dispatches, [1]);
    const next = changed.audit.retained.find((r) => r.status === 'UNACCEPTED');
    assert.equal(next.session, changed.audit.target.session);
    assert(next.requiredGates.includes('accept'));
    assert.notEqual(
      changed.audit.state.cases[changed.audit.id].continuation.observation.id,
      '100',
    );
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});
test('readiness and approvals reject before host effects', () => {
  const c = consumer();
  try {
    for (const mode of ['lookup', 'compute'])
      for (const capability of [
        'runtime',
        'workflow',
        'skills',
        'source',
        'recovery',
        'jobAdmission',
      ]) {
        for (const prefix of ['readiness-', 'incompatible-']) {
          const r = invoke(c, mode, { fault: prefix + capability });
          assert.notEqual(r.status, 0, mode + ': ' + capability);
          assert.equal(r.audit, null);
        }
      }
    for (const change of [
      { NIBFIN_SOURCE_APPROVALS: '{}' },
      {
        NIBFIN_READINESS_SOURCE:
          'export const observeCapability=()=>({status:"verified"})',
      },
      { NIBFIN_HOST_REPOSITORY: 'attacker/project' },
      { NIBFIN_HOST_OPTIONS: '{}' },
      { NIBFIN_HOST_CAPABILITY_SOURCE: 'throw Error("' + sentinel + '")' },
    ]) {
      const r = invoke(c, 'lookup', { change });
      assert.notEqual(r.status, 0);
      assert.equal(r.audit, null);
    }
    const path = join(c.dir, 'nibfin-host/host/entry.mjs'),
      original = readFileSync(path);
    writeFileSync(path, 'throw Error("' + sentinel + '")');
    const denied = invoke(c, 'lookup');
    assert.notEqual(denied.status, 0);
    assert.equal(denied.audit, null);
    writeFileSync(path, original);
    rmSync(join(c.dir, 'nibfin-host'), { recursive: true });
    const missing = invoke(c, 'lookup');
    assert.notEqual(missing.status, 0);
    assert.equal(missing.audit, null);
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});

test('compute creates independent Accept after grouped history', () => {
  const c = consumer();
  try {
    const r = invoke(c, 'compute', {
      fault: 'grouped',
      input: {
        nibfin_request: 'accept-request',
        nibfin_correlation: 'correlation-1',
        issue: '101',
      },
    });
    assert.equal(r.status, 0, r.output + r.stderr);
    assert(r.output.includes('status=completed'));
    const a = JSON.parse(readFileSync(join(c.dir, 'audit.grouped')));
    assert.equal(
      a.history.shape.execution.source.runId,
      a.history['shape-validator'].execution.source.runId,
    );
    assert.notEqual(a.run.id, a.old);
    assert.equal(a.run.id, '999');
    assert.deepEqual(a.current, a.history);
    assert.equal(a.records.length, 1);
    assert.equal(a.records[0].role, 'accept');
    const reused = invoke(c, 'compute', {
      fault: 'reused-history',
      input: {
        nibfin_request: 'accept-request',
        nibfin_correlation: 'correlation-1',
        issue: '101',
      },
    });
    assert.notEqual(reused.status, 0);
    assert(!reused.output.includes('status=completed'));
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});

test('timeouts and uncertain exits cannot publish success or secrets', () => {
  const c = consumer();
  try {
    for (const fault of [
      'malformed-output',
      'credential-output',
      'credential-output-encoded',
      'nonzero-success',
      'zero-failure',
    ]) {
      const r = invoke(c, 'lookup', { fault });
      assert.equal(r.status, 1, fault + ': ' + r.output);
      assert.equal(r.output, 'status=blocked\nreason=invalid-or-unavailable\n');
    }
    const loud = invoke(c, 'lookup', { fault: 'stdout' });
    assert.equal(loud.status, 0);
    assert.equal(loud.output, 'status=resolved\nissue=101\n');
    // Include immutable package verification before the deliberately hung owner.
    // The deadline still bounds the real child; keep enough startup budget for
    // the non-root single-CPU package fixture to reach its retained PID marker.
    const timed = invoke(c, 'lookup', { fault: 'hang', timeoutMs: 5000 });
    assert.equal(timed.status, 1);
    assert.equal(timed.output, 'status=blocked\nreason=invalid-or-unavailable\n');
    const pid = Number(readFileSync(join(c.dir, 'audit.pid'), 'utf8'));
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});

test('personal/Organization calls verify cryptographic source', () => {
  const c = consumer();
  try {
    const change = {
      GITHUB_REPOSITORY_ID: '9007199254740993',
      GITHUB_RUN_ID: '44',
      GITHUB_EVENT_NAME: 'workflow_dispatch',
    };
    for (const kind of [
      'personal',
      'organization',
      'actor',
      'attempt',
      'repository',
      'workflow',
      'version',
      'audience',
      'signature',
    ]) {
      const r = invoke(c, 'lookup', { fault: 'oidc-' + kind, change });
      const audit = JSON.parse(readFileSync(join(c.dir, 'audit.oidc')));
      if (['personal', 'organization'].includes(kind)) {
        assert.equal(r.status, 0, r.output);
        assert.equal(audit.lookup, 1);
      } else {
        assert.equal(r.status, 1, kind);
        assert.equal(audit.lookup, 0);
        assert.equal(audit.calls, 0);
      }
    }
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});

test('executable metadata and symlink tampering rejects before effects', () => {
  const c = consumer();
  try {
    for (const name of [
      'src/runtime.mjs',
      'src/index.mjs',
      'src/distribution-map.json',
      'src/distribution-contract.mjs',
      'npm-shrinkwrap.json',
      'package.json',
      'skills/deliver/SKILL.md',
      'workflow/templates/nibfin-delivery.yml',
      'host/runner-job-hook.sh',
    ]) {
      const path = join(c.dir, 'nibfin-bundle', name),
        bytes = readFileSync(path);
      for (const attack of ['change', 'missing', 'link']) {
        rmSync(path);
        if (attack === 'change')
          writeFileSync(path, Buffer.concat([bytes, Buffer.from('unsafe')]));
        if (attack === 'link') symlinkSync(join(upstream, name), path);
        const r = invoke(c, 'lookup');
        assert.equal(r.status, 1, name + ': ' + attack);
        assert.equal(r.audit, null);
        rmSync(path, { force: true });
        writeFileSync(path, bytes);
      }
    }
    const host = join(c.dir, 'nibfin-host');
    rmSync(host, { recursive: true });
    symlinkSync(join(upstream), host);
    const r = invoke(c, 'lookup');
    assert.equal(r.status, 1);
    assert.equal(r.audit, null);
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});
test('inert readiness distinguishes source/member capability', async () => {
  const { createInstallation } = await import('../.test-core/src/installation.mjs');
  for (const profile of ['source', 'member']) {
    const observed = [],
      probes = [];
    const configuration = {
      version: 1,
      expected: { packageVersion: pin.version, coreSha256: pin.components.core },
      profile,
      observeCapability: async (r) => {
        observed.push(r.capability);
        return { ...r, status: 'verified' };
      },
    };
    if (profile === 'member')
      configuration.runner = {
        configuration: {
          version: 1,
          platform: 'linux',
          arch: 'x64',
          path: '/usr/local/bin:/usr/bin:/bin',
          interpreter: '/usr/local/bin/node',
          work: '/fixture/work',
          scratch: '/fixture/scratch',
          cache: '/fixture/cache',
          account: { user: 'member', uid: 1000, githubUserId: '7' },
        },
        observe: async () => ({
          platform: 'linux',
          arch: 'x64',
          uid: 1000,
          user: 'member',
          tokenOverride: false,
          roots: { work: true, scratch: true, cache: true },
        }),
        probe: async (r) => {
          probes.push(r);
          return { status: 'verified', userId: '7' };
        },
      };
    const api = createInstallation(configuration);
    assert.deepEqual(observed, []);
    assert.deepEqual(probes, []);
    const result = await api.check();
    assert.equal(result.status, 'ready');
    assert.equal(
      result.scope,
      profile === 'source' ? 'source-contract' : 'member-runtime',
    );
    assert.deepEqual(observed, [
      'runtime',
      'workflow',
      'skills',
      'source',
      'recovery',
      'jobAdmission',
    ]);
    assert(!JSON.stringify(probes).includes('runner-job-hook'));
    assert(!JSON.stringify(probes).includes('register'));
  }
});

test('CI prepares exact Core without lifecycle scripts', () => {
  const w = parse(readFileSync('.github/workflows/ci.yml', 'utf8')),
    steps = w.jobs.action.steps;
  assert.deepEqual(w.permissions, { contents: 'read' });
  assert.equal(w.jobs.action.needs, 'owner-pr');
  assert(
    w.jobs['owner-pr'].steps[0].run.includes('PR_AUTHOR_ID !== process.env.OWNER_ID'),
  );
  for (const s of steps) {
    if (s.uses) assert.match(s.uses, /@[a-f0-9]{40}$/);
    if (s.uses?.startsWith('actions/checkout'))
      assert.equal(s.with['persist-credentials'], false);
  }
  const source = steps.find((s) => s.with?.repository === pin.repository);
  assert.equal(source.with.ref, pin.commit);
  assert.equal(source.with.path, '.test-producer');
  const prepare = steps.find((s) => s.name === 'Prepare reviewed producer archive');
  assert(prepare.run.includes('--ignore-scripts'));
  assert(prepare.run.includes('node tooling/test-input.mjs --build .test-producer'));
  const check = steps.findIndex((s) => s.run === 'node tooling/check.mjs'),
    lint = steps.findIndex((s) => s.run === 'node tooling/lint-workflows.mjs');
  assert(
    check >= 0 && lint > check,
    'Install locked YAML before compatibility lint runs',
  );
  assert.equal(steps.at(-1).run, 'node tooling/lint-workflows.mjs');
});

test('waiting selection and ignored wake remain distinct non-delivery results', () => {
  const c = consumer();
  try {
    const waiting = invoke(c, 'resolve', { fault: 'waiting' });
    assert.equal(waiting.status, 0, waiting.output);
    assert.equal(
      waiting.output,
      'status=waiting\nselected=false\nreason=all-unavailable\n',
    );
    assert.equal(waiting.audit.records, 0);
    const ignored = invoke(c, 'wake', { fault: 'ignored' });
    assert.equal(ignored.status, 0, ignored.output);
    assert.equal(ignored.output, 'status=ignored\n');
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});
