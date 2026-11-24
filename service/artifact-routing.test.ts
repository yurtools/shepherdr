import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
test('native evidence routing fixtures pass in an isolated Bun process', () => {
 const root = fileURLToPath(new URL('../', import.meta.url));
 const result = Bun.spawnSync([process.execPath, 'test', 'test/native/artifact-routing.test.ts'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
 if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr));
 expect(result.exitCode).toBe(0);
});

test('web evidence navigation fixtures pass in an isolated Bun process', () => {
 const root = fileURLToPath(new URL('../', import.meta.url));
 const result = Bun.spawnSync([process.execPath, 'test', 'test/web/artifact-navigation.test.ts'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
 if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr));
 expect(result.exitCode).toBe(0);
});
