import { writeFileSync } from 'node:fs';
const calls = [];
process.on('exit', () => {
  if (process.env.FIXTURE_AUDIT)
    writeFileSync(process.env.FIXTURE_AUDIT + '.readiness', JSON.stringify(calls));
});
export async function observeCapability(r) {
  calls.push({ capability: r.capability, version: r.version, sha256: r.sha256 });
  if (process.env.FIXTURE_CASE === 'readiness-' + r.capability) return null;
  if (process.env.FIXTURE_CASE === 'incompatible-' + r.capability)
    return { version: 99, status: 'verified', sha256: r.sha256 };
  return { ...r, status: 'verified' };
}
export const runner = {
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
  probe: async () => ({ status: 'verified', userId: '7' }),
};
