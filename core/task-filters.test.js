import { expect, test } from "bun:test";
import { filterChoices, filterKey, loadFilters, normalizeFilters, saveFilters, splitFilterChoices, toggleFilter } from "./task-filters.js";
import { place } from "./tasks.js";

test("status toggles are independent, canonical, and All or the last toggle clears them", () => {
  let selected = toggleFilter([], "working");
  selected = toggleFilter(selected, "needs");
  expect(selected).toEqual(["needs", "working"]);
  expect(toggleFilter(selected, "needs")).toEqual(["working"]);
  expect(toggleFilter(["working"], "working")).toEqual([]);
  expect(toggleFilter(selected, "all")).toEqual([]);
  expect(toggleFilter(selected, "unknown")).toEqual(selected);
  expect(toggleFilter(selected, "automations")).toEqual(["needs", "working", "automations"]);
});

test("old scalar values migrate, new values survive reload, invalid storage is harmless", () => {
  const data = new Map();
  const store = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  for (const [raw, expected] of [["working", ["working"]], ["automations", ["automations"]], ["all", []], ["\"needs\"", ["needs"]], ["bad JSON", []], ["{\"needs\":true}", []], ['["done","needs","bogus","done"]', ["needs", "done"]]]) {
    data.set("filter", raw);
    expect(loadFilters("filter", store)).toEqual(expected);
  }
  saveFilters("filter", ["working", "needs"], store);
  expect(data.get("filter")).toBe('["needs","working"]');
  expect(loadFilters("filter", store)).toEqual(["needs", "working"]);
  expect(normalizeFilters(["work", "need", "deferred"])).toEqual(["needs", "deferred", "working"]);
  expect(loadFilters("filter", { getItem() { throw Error("disabled"); } })).toEqual([]);
  expect(() => saveFilters("filter", [], { setItem() { throw Error("disabled"); } })).not.toThrow();
});

test("counts can become zero without clearing the selection; hidden selections survive width changes", () => {
  const selected = ["needs", "working", "deferred"];
  const choices = filterChoices(selected, (k) => k === "done" ? 4 : k === "needs" ? 2 : 0);
  expect(choices.map(({ key, count, on }) => [key, count, on])).toEqual([["needs", 2, true], ["deferred", 0, true], ["working", 0, true], ["done", 4, false]]);
  const narrow = splitFilterChoices(choices, 50, () => 100, 50);
  expect(narrow.shown).toEqual([]);
  expect(narrow.hiddenSelected).toBe(3);
  const medium = splitFilterChoices(choices, 150, () => 100, 50);
  expect(medium.shown.map((x) => x.key)).toEqual(["needs"]);
  expect(medium.hiddenSelected).toBe(2);
  const wide = splitFilterChoices(choices, 250, () => 100, 50);
  expect(wide.shown.map((x) => x.key)).toEqual(["needs", "working"]);
  expect(wide.hiddenSelected).toBe(1);
  expect(selected).toEqual(["needs", "working", "deferred"]);
});

test("status transitions use the canonical placement, not saved record state", () => {
  const selected = ["needs", "working"];
  const list = { prefix: "T", tasks: [] };
  const task = { id: 1, state: "running" };
  const visible = (task, status) => selected.includes(filterKey(place(list, task, { live: [{ address: "t1", status }] }).section));
  expect(visible(task, "blocked")).toBe(true);
  expect(visible(task, "working")).toBe(true);
  expect(visible({ ...task, state: "ready" }, "idle")).toBe(false);
  expect(visible({ ...task, state: "done" }, "idle")).toBe(false);
});
