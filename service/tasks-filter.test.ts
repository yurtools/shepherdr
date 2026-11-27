import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

// Keep native module mocks and their cached paths out of other suites.
test('native task status selection and More menu render fixtures', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const result = Bun.spawnSync([process.execPath, 'test', 'test/native/tasks-filter.test.ts'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr));
  expect(result.exitCode).toBe(0);
});
