import { writeFileSync } from 'node:fs';
import { makeRescue } from 'RESCUE_FIXTURE';
const { f, id, observed } = await makeRescue(process.env.FIXTURE_CASE);
process.on('exit', () =>
  writeFileSync(
    process.env.FIXTURE_AUDIT,
    JSON.stringify({
      id,
      observed,
      state: f.snapshot(),
      target: f.target,
      repairs: f.flags.repairs,
      diagnoses: f.flags.diagnoses,
      dispatches: [...f.ops.values()].map((o) => o.writes().length),
      retained: f.retained,
      tokens: [
        'NIBFIN_READ_TOKEN',
        'NIBFIN_HOST_TOKEN',
        'GH_TOKEN',
        'GITHUB_TOKEN',
      ].filter((k) => process.env[k]),
    }),
  ),
);
export const capabilities = {
  rescue: {
    authenticate: async ({ context }) => ({
      ...context,
      visibility: 'public',
      ownership: 'organization',
    }),
    rescue: async () => f.options,
  },
};
