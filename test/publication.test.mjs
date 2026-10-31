import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import {
  publish,
  repository,
  repositoryId,
  githubRequest,
} from '../tooling/publish.mjs';
import { verifyPackage } from '../tooling/package.mjs';
import { hash, pin } from '../src/contract.mjs';
function fixture() {
  const m = structuredClone(verifyPackage()),
    sha = 'a'.repeat(40);
  m.source.kind = 'merged';
  m.source.commit = sha;
  const assets = new Map([
    ['nibfin-action.tgz', readFileSync('out/nibfin-action.tgz')],
    ['action-release-manifest.json', Buffer.from(JSON.stringify(m))],
  ]);
  const run = {
      repository,
      repositoryId,
      sha,
      ref: 'refs/heads/main',
      event: 'push',
      id: '7',
      attempt: '1',
    },
    records = [],
    calls = [];
  const base = '/repos/' + repository,
    state = {
      core: 'integrated',
      release: null,
      assets: [],
      tag: null,
      enabled: true,
      protected: true,
      merged: true,
      fault: null,
    };
  async function request(q) {
    calls.push(q);
    const p = q.path;
    let result;
    if (q.method === 'GET') {
      if (p.startsWith('/repos/' + pin.repository + '/')) {
        if (p.includes('/releases/tags/'))
          result = {
            id: 233,
            immutable: true,
            draft: false,
            prerelease: false,
            tag_name: 'v' + pin.version,
            target_commitish:
              state.core === 'historical'
                ? 'ae64437d072d16ebad1ed119f6f7ab9c6b459e44'
                : pin.commit,
          };
        else if (p.includes('/git/ref/'))
          result = { object: { type: 'commit', sha: pin.commit } };
        else if (p.includes('/assets?'))
          result = pin.assets.map((a) => ({
            name: a.name,
            size: a.bytes,
            digest: 'sha256:' + a.sha256,
            state: 'uploaded',
          }));
        else throw Error('unexpected core GET');
        if (state.core === 'missing') return { status: 404 };
        if (state.core === 'denied') return { status: 403 };
        if (state.core === 'mutable' && result.immutable) result.immutable = false;
        if (state.core === 'altered' && Array.isArray(result))
          result[0].digest = 'sha256:' + 'f'.repeat(64);
      } else if (p === base)
        result = {
          id: Number(repositoryId),
          full_name: repository,
          visibility: 'public',
        };
      else if (p.endsWith('/branches/main')) result = { protected: state.protected };
      else if (p.includes('/commits/'))
        result = state.merged
          ? [
              {
                merged_at: 'now',
                merge_commit_sha: sha,
                base: { ref: 'main', repo: { id: repositoryId } },
              },
            ]
          : [];
      else if (p.endsWith('/immutable-releases')) result = { enabled: state.enabled };
      else if (p.includes('/git/ref/')) {
        if (!state.tag) return { status: 404 };
        result = { object: { type: 'commit', sha: state.tag } };
      } else if (p.includes('/releases?'))
        result = state.release ? [state.release] : [];
      else if (p.includes('/assets?')) result = state.assets;
      else if (p.includes('/releases/')) {
        if (!state.release) return { status: 404 };
        result = state.release;
      } else throw Error('unexpected GET');
      if (state.fault === 'readback' && p.includes('/releases/tags/'))
        return { status: 403 };
      return { status: 200, data: structuredClone(result) };
    }
    if (state.fault === 'denied') return { status: 403 };
    if (q.method === 'PATCH') {
      state.release = {
        ...state.release,
        draft: false,
        immutable: true,
        published_at: 'now',
      };
      state.tag = sha;
      result = state.release;
    } else if (p.startsWith('https://uploads.github.com/')) {
      const name = new URL(p).searchParams.get('name');
      state.assets.push({
        id: state.assets.length + 1,
        name,
        size: q.bytes.length,
        digest: 'sha256:' + hash(q.bytes),
        state: 'uploaded',
        browser_download_url:
          'https://github.com/' +
          repository +
          '/releases/download/v' +
          m.version +
          '/' +
          name,
      });
      result = state.assets.at(-1);
    } else {
      state.release = {
        ...q.data,
        id: 4,
        immutable: false,
        html_url: 'https://github.com/' + repository + '/releases/tag/v' + m.version,
      };
      result = state.release;
    }
    if (state.fault === 'unknown') {
      state.fault = null;
      throw Error('SECRET-RAW-TRANSPORT');
    }
    if (state.fault === 'server') {
      state.fault = null;
      return { status: 503 };
    }
    return {
      status: q.method === 'PATCH' ? 200 : 201,
      data: structuredClone(result),
    };
  }
  return {
    m,
    assets,
    run,
    state,
    records,
    calls,
    args: () => ({
      manifest: m,
      assets,
      run,
      request,
      record: (r) => records.push(r),
    }),
  };
}
test('publication binds draft, immutable assets and version reconciliation', async () => {
  const f = fixture();
  const r = await publish(f.args());
  assert.equal(r.status, 'published');
  assert.equal(r.release.immutable, true);
  assert.equal(r.assets.length, 2);
  assert.equal(
    r.run.url,
    'https://github.com/' + repository + '/actions/runs/7/attempts/1',
  );
  const writes = f.calls.filter((c) => c.method !== 'GET');
  assert.deepEqual(
    writes.map((c) => c.method),
    ['POST', 'POST', 'POST', 'PATCH'],
  );
  f.calls.length = 0;
  assert.equal((await publish(f.args())).status, 'published');
  assert(f.calls.every((c) => c.method === 'GET'));
  f.state.assets[0].digest = 'sha256:' + '0'.repeat(64);
  await assert.rejects(publish(f.args()));
});
test('unknown writes stop until authorized matching readback', async () => {
  for (const fault of ['unknown', 'server']) {
    const f = fixture();
    f.state.fault = fault;
    await assert.rejects(publish(f.args()));
    assert.equal(f.calls.filter((c) => c.method !== 'GET').length, 1);
    assert.equal(f.records.at(-1).status, 'unknown');
    assert(!JSON.stringify(f.records).includes('SECRET'));
    f.calls.length = 0;
    assert.equal((await publish(f.args())).status, 'published');
    assert.equal(
      f.calls.filter((c) => c.method === 'POST' && !c.path.startsWith('https:'))
        .length,
      0,
    );
  }
});
test('publication rejects unavailable immutability and invalid inputs', async () => {
  for (const change of [
    (f) => (f.state.enabled = false),
    (f) => (f.state.protected = false),
    (f) => (f.state.merged = false),
    (f) => (f.state.tag = 'b'.repeat(40)),
    (f) => (f.m.source.kind = 'candidate'),
    (f) => (f.run.sha = 'b'.repeat(40)),
    (f) => (f.run.ref = 'refs/pull/8/merge'),
    (f) => (f.run.event = 'pull_request'),
    (f) => (f.run.repository = 'other/repo'),
    (f) => f.assets.delete('nibfin-action.tgz'),
    (f) => f.assets.set('nibfin-action.tgz', Buffer.from('changed')),
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(publish(f.args()));
    assert(f.calls.every((c) => c.method === 'GET'));
  }
  for (const fault of ['denied', 'readback']) {
    const f = fixture();
    f.state.fault = fault;
    await assert.rejects(publish(f.args()));
    assert.notEqual(f.records.at(-1).status, 'published');
    assert.equal(f.records.at(-1).httpStatus, 403);
  }
  const f = fixture();
  await publish(f.args());
  f.state.release.target_commitish = 'b'.repeat(40);
  f.calls.length = 0;
  await assert.rejects(publish(f.args()));
  assert(f.calls.every((c) => c.method === 'GET'));
  for (const change of [
    (f) => (f.state.release.immutable = false),
    (f) => (f.state.release.draft = true),
    (f) => f.state.assets.pop(),
  ]) {
    const g = fixture();
    await publish(g.args());
    change(g);
    if (g.state.release.draft) {
      g.state.fault = 'denied';
    }
    await assert.rejects(publish(g.args()));
  }
  assert.throws(() => githubRequest(''));
  await assert.rejects(
    githubRequest('sentinel')({ method: 'GET', path: 'https://evil.example/' }),
  );
});
test('release workflow preserves source, writes and permission pins', () => {
  const w = parse(readFileSync('.github/workflows/action-release.yml', 'utf8'));
  assert.deepEqual(Object.keys(w.on), ['workflow_dispatch']);
  assert.deepEqual(w.permissions, { contents: 'read' });
  assert.deepEqual(w.concurrency, {
    group: 'nibfin-action-release',
    'cancel-in-progress': false,
  });
  const j = w.jobs.publish;
  assert.equal(j.environment, 'nibfin-release');
  assert.deepEqual(j.permissions, { contents: 'write' });
  assert(j.if.includes("github.ref == 'refs/heads/main'"));
  for (const s of j.steps) {
    if (s.uses) assert.match(s.uses, /@[a-f0-9]{40}$/);
    if (s.run) assert(!s.run.includes('${{'));
  }
  const p = j.steps.find((s) => s.run === 'node tooling/publish.mjs');
  assert(p);
  assert.equal(p.if, undefined);
  assert.equal(p.env.NIBFIN_RELEASE_TOKEN, '${{ github.token }}');
  assert.equal(p.env.NIBFIN_RELEASE_IMMUTABILITY_POLICY, 'repository-enforced');
  assert.equal(j.steps[0].with.ref, '${{ github.sha }}');
  assert.equal(j.steps[0].with['persist-credentials'], false);
  const bind = j.steps.find((s) => s.run === 'node tooling/package.mjs');
  assert.equal(bind.env.NIBFIN_RELEASE_COMMIT, '${{ github.sha }}');
});

test('#15 rejects unavailable or altered #203 Core before Action writes', async () => {
  for (const mode of ['missing', 'historical', 'denied', 'mutable', 'altered']) {
    const f = fixture();
    f.state.core = mode;
    await assert.rejects(publish(f.args()));
    assert(
      f.calls.every((c) => c.method === 'GET'),
      mode,
    );
  }
});

test('publication transport restricts producer reads and Action writes', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return { status: 200, json: async () => ({}) };
  });
  const request = githubRequest('publication-token');
  assert.equal(
    (
      await request({
        method: 'GET',
        path: '/repos/' + pin.repository + '/releases/tags/v' + pin.version,
      })
    ).status,
    200,
  );
  for (const [method, path] of [
    ['POST', '/repos/' + pin.repository + '/releases'],
    ['GET', '/repos/' + pin.repository + '-other/releases'],
    [
      'POST',
      'https://uploads.github.com/repos/' + pin.repository + '/releases/1/assets',
    ],
  ])
    await assert.rejects(request({ method, path }));
  assert.equal(calls.length, 1);
});

test('job-token publication requires immutable repository readback', async () => {
  const f = fixture(),
    request = f.args().request;
  const args = {
    ...f.args(),
    immutabilityPolicy: 'repository-enforced',
    request: (q) => {
      assert(!q.path.endsWith('/immutable-releases'));
      return request(q);
    },
  };
  assert.equal((await publish(args)).status, 'published');
  const g = fixture();
  await publish(g.args());
  g.state.release.immutable = false;
  await assert.rejects(
    publish({ ...g.args(), immutabilityPolicy: 'repository-enforced' }),
  );
  await assert.rejects(
    publish({ ...fixture().args(), immutabilityPolicy: 'unchecked' }),
  );
});
