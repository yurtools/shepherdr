import { expect, test } from "bun:test";
import { artifactOf, artifactStore } from "./compat.ts";

test("a space's artifact store is herdr-artifact's: the repo's main folder, named as the window's Artifacts header", () => {
  expect(artifactStore({ folder: "/h/u" }, "/h/u")).toEqual({ folder: "/h/u", key: "|/h/u", name: "~" });
  expect(artifactStore({ folder: "/h/u/wt/x", git: { repo: "/h/u/dev/app/.git" } }, "/h/u")).toEqual({ folder: "/h/u/dev/app", key: "|/h/u/dev/app", name: "app" });
  // another machine's home reads "~" there too; its key names the machine
  expect(artifactStore({ folder: "/root", machine: "vm" }, "/h/u")).toEqual({ folder: "/root", key: "vm|/root", name: "~" });
  expect(artifactStore({ folder: "/root/dev/site", machine: "vm" }, "/h/u").name).toBe("site");
});

test("each version says its kind and its window picture: a converted one was a panel, then a recipe", () => {
  const a = artifactOf({ id: "x-1a2b", title: "Plan", version: 2, at: 2, folder: "/h/u", files: ["recipe.json"],
    versions: [{ v: 1, at: 1, kind: "custom", picture: 5 }, { v: 2, at: 2, kind: "recipe" }] }, []);
  expect(a.kind).toBe("recipe");
  expect(a.versions.map((x) => [x.n, x.kind, x.picture])).toEqual([[2, "recipe", undefined], [1, "gpui", 5]]);
});

test("artifact ownership uses the task's saved space, including a deleted space and a remote ID collision", () => {
  const a = { id: 'proof-1234', task: 'SHOP-4', folder: '/repo', version: 1 };
  const spaces: any[] = [{ id: 'A', folder: '/a', machine: null }, { id: 'B', folder: '/repo', machine: null }, { id: 'vm/A', folder: '/repo', machine: 'vm' }];
  const tasks = [{ ref: 'SHOP-4', folder: '/repo', space: 'A', machine: null }, { ref: 'SHOP-4', folder: '/repo', space: 'vm/A', machine: 'vm' }];
  expect(artifactOf(a, spaces, undefined, tasks).place).toBe('A');
  expect(artifactOf({ ...a, machine: 'vm' }, spaces, undefined, tasks).place).toBe('vm/A');
  expect(artifactOf(a, spaces.filter(s => s.id !== 'A'), undefined, tasks).place).toBe('');
  expect(artifactOf({ ...a, task: null }, spaces).place).toBe('');
});
