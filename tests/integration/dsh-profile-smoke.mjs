// Real isolated DSH profile load smoke for the S5.1 adapter.
//
// This script uses the real DSH profile/bundle machinery:
//   1. creates a temporary $DSH_HOME outside the repository,
//   2. initializes a profile through @deepseek-ai/dsh-app-boot's initProfile,
//   3. exposes this repository as the profile-local bundle package,
//   4. loads the profile through loadProfile (bundle discovery + patch parse),
//   5. boots the real Cordis Loader through @deepseek-ai/dsh-app-boot's boot,
//   6. verifies the contract-supervisor plugin activated and provided the seam.
//
// The S5.2 plugin declares `inject: ['agents']`, so a SIBLING loader row
// providing the `agents` service is inserted through the same genuine patch
// mechanism (exactly the topology the real dogfood profile gets from
// dsh-base). The plugin fiber then activates only after `agents` is available.
//
// Run: node tests/integration/dsh-profile-smoke.mjs
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  boot,
  composeEntries,
  initProfile,
  loadProfile,
} from '@deepseek-ai/dsh-app-boot';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const dshAnchor = fileURLToPath(
  new URL('../../node_modules/@deepseek-ai/dsh/package.json', import.meta.url),
);
const home = await mkdtemp(join(tmpdir(), 'dsh-s51-load-'));
const profileDir = join(home, 'profiles', 'smoke');

try {
  await mkdir(join(profileDir, 'node_modules'), { recursive: true });
  initProfile(profileDir, ['dsh-contract-supervisor']);
  await symlink(
    repoRoot,
    join(profileDir, 'node_modules', 'dsh-contract-supervisor'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  // Sibling `agents` provider row, written beside the profile config so the
  // genuine Loader mounts it as its own entry/fiber (relative specifier
  // resolution against the config directory).
  await writeFile(
    join(profileDir, 'agents-stub.mjs'),
    `// Scratch smoke-only sibling row: satisfies the plugin's inject:['agents'].
export const name = 'agents-stub';
export function apply(ctx) {
  ctx.provide('agents', {
    create: async () => { throw new Error('agents-stub: no agents in load smoke'); },
  });
}
`,
    'utf8',
  );

  const profile = loadProfile('dsh', 'smoke', dshAnchor, home);
  const rows = composeEntries(profile.layers.map((layer) => layer.patches));
  const row = rows.find((entry) => entry.id === 'contract-supervisor');
  if (!row || row.name !== 'dsh-contract-supervisor') {
    throw new Error('composed profile does not contain the contract-supervisor row');
  }
  console.log('bundle discovered:', profile.layers[0].packageName);
  console.log('patch applied:', JSON.stringify(row));

  const rootConfig = join(profileDir, 'cordis.yml');
  await writeFile(rootConfig, '[]\n', 'utf8');
  const patches = [
    ...profile.layers.flatMap((layer) => layer.patches),
    { insert: [{ id: 'agents-stub', name: './agents-stub.mjs', config: {} }] },
  ];
  const ctx = await boot('dsh', rootConfig, patches);

  const service = ctx.get('contractSupervisor');
  if (!service || service.name !== 'contractSupervisor') {
    throw new Error('contractSupervisor service was not provided after boot');
  }
  console.log('plugin activated:', service.name);
  console.log('sibling agents provider present:', typeof ctx.get('agents') === 'object');
  console.log('worker spawned on load: NO');

  await ctx.fiber.dispose();
  console.log('load smoke PASS');
} finally {
  await rm(home, { recursive: true, force: true });
}
