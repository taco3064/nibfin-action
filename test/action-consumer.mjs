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
import { parse } from 'yaml';
import { pin, hash, verifyCore, project } from '../src/contract.mjs';
import { verifyPackage, inspectArchive, runtimeFiles } from '../tooling/package.mjs';
const readinessSource = readFileSync(
  new URL('./fixtures/readiness.mjs', import.meta.url),
  'utf8',
);
const root = resolve('.'),
  upstream = resolve('.test-core'),
  sentinel = 'SECRET-RAW-PROVIDER-SENTINEL';
const fixtureSource = readFileSync(
  new URL('./fixtures/host.mjs', import.meta.url),
  'utf8',
).replaceAll('FIXTURE_SENTINEL', sentinel);
export function consumer() {
  verifyPackage(root);
  verifyCore(upstream);

  const dir = mkdtempSync(join(tmpdir(), 'nibfin-consumer-')),
    pkg = join(dir, 'action');
  mkdirSync(pkg);
  const files = inspectArchive(readFileSync('out/nibfin-action.tgz'), runtimeFiles);
  for (const [name, bytes] of files) {
    mkdirSync(join(pkg, name, '..'), { recursive: true });
    writeFileSync(join(pkg, name), bytes);
  }
  cpSync(upstream, join(dir, 'nibfin-bundle'), {
    recursive: true,
    filter: (p) =>
      !p.split('/').includes('node_modules') && !p.split('/').includes('.git'),
  });
  cpSync(join(upstream, 'node_modules'), join(dir, 'nibfin-bundle/node_modules'), {
    recursive: true,
  });
  mkdirSync(join(dir, 'nibfin-host'));
  cpSync(join(upstream, 'host'), join(dir, 'nibfin-host/host'), { recursive: true });
  cpSync(join(root, '.test-fixtures'), join(dir, '.test-fixtures'), {
    recursive: true,
  });
  for (const file of readdirSync(join(dir, '.test-fixtures'))) {
    const p = join(dir, '.test-fixtures', file);
    writeFileSync(
      p,
      readFileSync(p, 'utf8').replaceAll('../.test-core/', '../nibfin-bundle/'),
    );
  }
  cpSync(join(root, 'node_modules'), join(dir, 'node_modules'), { recursive: true });
  mkdirSync(join(dir, 'test'));
  for (const name of ['rescue-fixture.mjs', 'grouped-fixture.mjs'])
    writeFileSync(
      join(dir, 'test', name),
      readFileSync('test/' + name, 'utf8').replaceAll(
        '../.test-core/',
        '../nibfin-bundle/',
      ),
    );
  return { dir, pkg, meta: parse(readFileSync(join(pkg, 'action.yml'), 'utf8')) };
}
export function invoke(
  c,
  mode,
  { fault = '', change = {}, input, deploymentSource, timeoutMs } = {},
) {
  const entryUrl = pathToFileURL(join(c.pkg, 'src/entry.mjs')).href;
  const data =
    input ??
    (mode === 'lookup'
      ? { nibfin_request: 'request-1', nibfin_correlation: 'correlation-1' }
      : mode === 'registration'
        ? {
            nibfin_registration: 'request-1',
            level: 'repository',
            public_key: readFileSync(join(c.dir, 'public.pem'), 'utf8'),
          }
        : mode === 'wake'
          ? { event: {} }
          : {
              nibfin_request: mode === 'execute' ? 'publish-request' : 'request-1',
              nibfin_correlation: 'correlation-1',
              issue: '101',
            });
  const env = {
    ...process.env,
    GITHUB_WORKSPACE: c.dir,
    GITHUB_REPOSITORY: mode === 'registration' ? 'example/core' : 'example-org/core',
    GITHUB_REPOSITORY_ID: '42',
    GITHUB_RUN_ID:
      fault === 'grouped'
        ? '999'
        : mode === 'rescue'
          ? '200'
          : mode === 'execute'
            ? '102'
            : mode === 'registration'
              ? '91'
              : '100',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_EVENT_NAME: mode === 'rescue' ? 'workflow_dispatch' : 'issues',
    GITHUB_EVENT_PATH: join(c.dir, 'event.json'),
    GITHUB_OUTPUT: join(c.dir, 'output'),
    FIXTURE_AUDIT: join(c.dir, 'audit'),
    FIXTURE_CASE: fault,
    NIBFIN_ACTION_ROOT: c.pkg,
    NIBFIN_BUNDLE_COMMIT: pin.commit,
    NIBFIN_HOST_COMMIT: 'b'.repeat(40),
    NIBFIN_MODE: mode,
    NIBFIN_INPUT: JSON.stringify(data),
    NIBFIN_RESOLUTION: 'ref-resolution',
    NIBFIN_HOST_REPOSITORY: pin.repository,
    NIBFIN_HOST_TOKEN: sentinel,
    NIBFIN_READ_TOKEN: sentinel,
    GH_TOKEN: sentinel,
    GITHUB_TOKEN: sentinel,
    ...change,
  };
  env.NIBFIN_HOST_OPTIONS = JSON.stringify({
    [mode]: {
      version: 1,
      repository: env.GITHUB_REPOSITORY,
      repositoryId: env.GITHUB_REPOSITORY_ID,
      environment: ['compute', 'execute'].includes(mode)
        ? 'nibfin-member'
        : 'nibfin-hosted',
    },
  });
  env.NIBFIN_HOST_CAPABILITY_SOURCE = fixtureSource
    .replaceAll('FIXTURE/', pathToFileURL(join(c.dir, '.test-fixtures/')).href)
    .replace('CORE', pathToFileURL(join(c.dir, 'nibfin-bundle/src/index.mjs')).href)
    .replace('GROUPED', pathToFileURL(join(c.dir, 'test/grouped-fixture.mjs')).href);
  if (deploymentSource) env.NIBFIN_HOST_CAPABILITY_SOURCE = deploymentSource;
  env.NIBFIN_READINESS_SOURCE = readinessSource;
  env.NIBFIN_SOURCE_APPROVALS = JSON.stringify({
    bundle: { repository: pin.repository, commit: pin.commit, files: pin.files },
    host: {
      repository: pin.repository,
      commit: env.NIBFIN_HOST_COMMIT,
      files: pin.files.filter((f) => f.path.startsWith('host/')),
    },
    deployment: {
      sourceSha256: hash(env.NIBFIN_HOST_CAPABILITY_SOURCE),
      optionsSha256: hash(env.NIBFIN_HOST_OPTIONS),
    },
    readiness: { sourceSha256: hash(env.NIBFIN_READINESS_SOURCE) },
  });
  Object.assign(env, change);
  writeFileSync(env.GITHUB_OUTPUT, '');
  rmSync(env.FIXTURE_AUDIT, { force: true });
  writeFileSync(
    env.GITHUB_EVENT_PATH,
    JSON.stringify({
      action: 'labeled',
      repository: { id: 42 },
      issue: { node_id: 'I_101', number: 101, labels: [] },
      label: { name: fault === 'ignored' ? 'not-nibfin' : 'shaped' },
    }),
  );
  const step = c.meta.runs.steps.find((s) => s.id === 'entry');
  assert.equal(step.run, 'node "$NIBFIN_ACTION_ROOT/src/entry.mjs"');
  const r = timeoutMs
    ? spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `const {main}=await import(${JSON.stringify(entryUrl)});` +
            `process.exitCode=await main(process.env,'invoke',` +
            `{timeoutMs:${timeoutMs}});`,
        ],
        { env, encoding: 'utf8', timeout: 10000 },
      )
    : spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
        env,
        encoding: 'utf8',
        timeout: 30000,
      });
  const output = readFileSync(env.GITHUB_OUTPUT, 'utf8');
  assert(!output.includes(sentinel));
  assert(!(r.stdout + r.stderr).includes(sentinel));
  let audit = null;
  try {
    audit = JSON.parse(readFileSync(env.FIXTURE_AUDIT));
  } catch {}
  return { ...r, output, audit };
}
async function rescueCall(c, scenario, { inputChange = {}, change = {} } = {}) {
  const { makeRescue } = await import('./rescue-fixture.mjs');
  const { id } = await makeRescue(scenario);
  const source = readFileSync(
    new URL('./fixtures/rescue-host.mjs', import.meta.url),
    'utf8',
  ).replace(
    'RESCUE_FIXTURE',
    pathToFileURL(join(c.dir, 'test/rescue-fixture.mjs')).href,
  );
  return invoke(c, 'rescue', {
    fault: scenario,
    deploymentSource: source,
    input: {
      request_id: id,
      source_run_id: '100',
      source_attempt: '1',
      mode: [
        'resolved',
        'stage-recovered',
        'stale-cycle',
        'ambiguous-completion',
        'early-completion',
      ].includes(scenario)
        ? 'verify'
        : 'repair',
      nibfin_correlation: 'correlation-1',
      nibfin_issue: '101',
      ...inputChange,
    },
    change,
  });
}
export { root, upstream, sentinel, rescueCall };
