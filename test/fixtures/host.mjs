import { writeFileSync } from 'node:fs';
import { workflowFixture } from 'FIXTURE/workflow-fixture.mjs';
import { registrationFixture } from 'FIXTURE/registration-fixture.mjs';
import { relayFixture } from 'FIXTURE/relay-fixture.mjs';
import { hostIdentityFixture } from 'FIXTURE/host-identity-fixture.mjs';
import { prepareGrouped } from 'GROUPED';
async function fixtureHost({ core, mode, context }) {
  const f = await workflowFixture(),
    fault = process.env.FIXTURE_CASE;
  if (typeof core.createWorkflowEntry !== 'function') throw Error('wrong loader');
  process.on('exit', () =>
    writeFileSync(
      process.env.FIXTURE_AUDIT,
      JSON.stringify({
        records: f.sh.records.length,
        calls: f.calls.length,
        tokens: [
          'NIBFIN_READ_TOKEN',
          'NIBFIN_HOST_TOKEN',
          'GH_TOKEN',
          'GITHUB_TOKEN',
        ].filter((k) => process.env[k]),
      }),
    ),
  );
  if (fault === 'unavailable') {
    console.log('FIXTURE_SENTINEL');
    throw Error('FIXTURE_SENTINEL');
  }
  if (fault === 'missing-auth') delete f.host.authenticate;
  if (fault === 'denied-auth')
    f.host.authenticate = async () => {
      throw Error('FIXTURE_SENTINEL');
    };
  if (fault === 'permission') f.state.denied = true;
  if (fault === 'waiting')
    for (const r of f.sf.routes[f.sf.prefix + '/actions/runners?per_page=100']
      .runners)
      r.status = 'offline';
  if (fault === 'hang')
    f.host.lookup = async () => {
      writeFileSync(process.env.FIXTURE_AUDIT + '.pid', String(process.pid));
      setInterval(() => {}, 1000);
      return new Promise(() => {});
    };
  if (fault === 'stdout') {
    console.log('FIXTURE_SENTINEL');
    console.error('FIXTURE_SENTINEL');
  }
  if (fault === 'malformed-output')
    writeFileSync(
      process.env.GITHUB_OUTPUT,
      'status=resolved\nstatus=completed\nreference=FIXTURE_SENTINEL\n',
    );
  if (fault.startsWith('credential-output'))
    f.host.lookup = async () => {
      writeFileSync(
        process.env.GITHUB_OUTPUT,
        'status=resolved\nreference=' +
          (fault === 'credential-output-encoded'
            ? Buffer.from(process.env.NIBFIN_HOST_TOKEN).toString('base64url')
            : process.env.NIBFIN_HOST_TOKEN) +
          '\n',
      );
      process.exit(0);
    };
  if (fault === 'nonzero-success')
    f.host.lookup = async () => {
      writeFileSync(process.env.GITHUB_OUTPUT, 'status=completed\n');
      process.exit(2);
    };
  if (fault === 'zero-failure')
    f.host.lookup = async () => {
      writeFileSync(process.env.GITHUB_OUTPUT, 'status=blocked\n');
      process.exit(0);
    };
  if (fault === 'newline')
    f.host.lookup = async () => ({
      ...f.queuedRequest.target,
      number: '101\ninjected=yes',
    });
  if (mode === 'execute') {
    const a = await f.core.run(await f.queued()),
      authored = a.owner.output,
      r = authored.author.receipt;
    f.pin.shapeBody = authored.author.body;
    f.pin.binding.shapeHash = core.bodyDigest(f.pin.shapeBody);
    f.pin.receipts.shape = r;
    f.pin.evidenceCurrent.shape = { expected: structuredClone(r), consumed: [] };
    f.pin.stageInput = authored;
    f.pin.invocation = {
      request: 'validator-request',
      run: { id: '101', attempt: '1' },
    };
    const v = await f.core.run(await f.queued()),
      validated = v.owner.output,
      vr = validated.validator.receipt;
    f.pin.receipts['shape-validator'] = vr;
    f.pin.evidenceCurrent['shape-validator'] = {
      expected: structuredClone(vr),
      consumed: [],
    };
    f.pin.stageInput = validated;
    f.pin.invocation = {
      request: 'publish-request',
      run: { id: '102', attempt: '1' },
    };
    Object.assign(f.queuedRequest, await f.queued());
    f.input.nibfin_request = 'publish-request';
    f.input.nibfin_stage = 'publication';
    f.identity.run = { id: '102', attempt: '1' };
  }
  let grouped;
  if (fault === 'grouped' || fault === 'reused-history')
    grouped = await prepareGrouped(f, fault === 'reused-history');
  if (grouped)
    process.on('exit', () => {
      writeFileSync(
        process.env.FIXTURE_AUDIT + '.grouped',
        JSON.stringify({
          history: grouped.history,
          current: f.pin.receipts,
          old: grouped.old,
          run: f.pin.invocation.run,
          records: grouped.a.records,
        }),
      );
      grouped.a.close();
    });
  if (['compute', 'execute'].includes(mode))
    await f.entry.invoke('resolve', f.input, context);
  if (fault === 'unknown') {
    const retain = f.host.retain;
    f.host.retain = async (r) => {
      if (r.kind === 'stage-result') throw Error('FIXTURE_SENTINEL');
      return retain(r);
    };
  }
  if (mode === 'wake') {
    const r = await relayFixture();
    f.host.relay = async () => r.configuration();
  }
  if (mode === 'registration') {
    const r = registrationFixture();
    f.host.authenticate = async () => ({
      ...context,
      visibility: 'public',
      ownership: 'personal',
    });
    r.s.publicKey = JSON.parse(process.env.NIBFIN_INPUT).public_key;
    f.host.registration = async () => ({
      config: {
        authenticate: async () => r.s,
        policy: async () => r.p,
        transport: r.transport,
        channel: r.channel,
        now: () => r.state.now,
      },
      handle: 'opaque',
      prior: 'new',
    });
  }
  if (fault.startsWith('oidc-')) {
    const h = await hostIdentityFixture('lookup'),
      kind = fault.slice(5);
    if (kind === 'personal') h.replies['/repos/example-org/core'].owner.type = 'User';
    if (
      ['actor', 'attempt', 'repository', 'workflow', 'version', 'audience'].includes(
        kind,
      )
    )
      h.state.token = await h.sign({
        [{
          actor: 'actor_id',
          attempt: 'run_attempt',
          repository: 'repository_id',
          workflow: 'workflow_ref',
          version: 'workflow_sha',
          audience: 'aud',
        }[kind]]: 'forged',
      });
    if (kind === 'signature')
      h.state.token = h.state.token.slice(0, -10) + 'forgeddata';
    const adapter = h.make();
    f.host.authenticate = (argument) => adapter.authenticate(argument);
    f.host.lookup = async () => {
      h.state.lookup++;
      return {
        repository: h.config.options.repository,
        repositoryId: h.config.options.repositoryId,
        number: '101',
      };
    };
    process.on('exit', () =>
      writeFileSync(
        process.env.FIXTURE_AUDIT + '.oidc',
        JSON.stringify({ calls: h.calls.length, lookup: h.state.lookup }),
      ),
    );
  }
  return Object.fromEntries(names[mode].map((k) => [k, f.host[k]]));
}
const names = {
  lookup: ['authenticate', 'lookup'],
  resolve: ['authenticate', 'delivery', 'retain'],
  execute: ['authenticate', 'delivery', 'retain', 'retrieve', 'verifyRunner'],
  compute: ['authenticate', 'delivery', 'retain', 'retrieve', 'verifyRunner'],
  wake: ['authenticate', 'relay'],
  registration: ['authenticate', 'registration', 'retain'],
};
const mode = process.env.NIBFIN_MODE;
const context = {
  repository: process.env.GITHUB_REPOSITORY,
  repositoryId: process.env.GITHUB_REPOSITORY_ID,
  run: { id: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT },
};
const core = await import('CORE');
export const capabilities = { [mode]: await fixtureHost({ core, mode, context }) };
