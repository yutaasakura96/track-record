/**
 * The reorder behind every Move up / Move down. The screen tests click one
 * button and read the saved body, so a move that landed two places away or
 * dropped a neighbour could still pass one of them; this pins each position.
 */
import { describe, expect, it } from "vitest";
import { moved } from "~/client/reorder";

const LIST = ["qorvane", "zentrel", "plinth", "quillset"] as const;

describe("moved", () => {
  it("moves the first item down one place", () => {
    expect(moved(LIST, 0, 1)).toEqual(["zentrel", "qorvane", "plinth", "quillset"]);
  });

  it("moves the last item up one place", () => {
    expect(moved(LIST, 3, -1)).toEqual(["qorvane", "zentrel", "quillset", "plinth"]);
  });

  it("moves a middle item up one place", () => {
    expect(moved(LIST, 2, -1)).toEqual(["qorvane", "plinth", "zentrel", "quillset"]);
  });

  it("moves a middle item down one place", () => {
    expect(moved(LIST, 1, 1)).toEqual(["qorvane", "plinth", "zentrel", "quillset"]);
  });

  it("swaps a list of two", () => {
    expect(moved(["qorvane", "zentrel"], 0, 1)).toEqual(["zentrel", "qorvane"]);
    expect(moved(["qorvane", "zentrel"], 1, -1)).toEqual(["zentrel", "qorvane"]);
  });

  it("is undone by the opposite move", () => {
    expect(moved(moved(LIST, 1, 1), 2, -1)).toEqual([...LIST]);
  });

  it("returns a new list, leaves the input as it was, and keeps each item itself", () => {
    const blocks = [{ id: "blk-test-1" }, { id: "blk-test-2" }, { id: "blk-test-3" }];
    const before = [...blocks];

    const after = moved(blocks, 1, -1);

    expect(after).not.toBe(blocks);
    expect(blocks).toEqual(before);
    expect(after[0]).toBe(blocks[1]);
    expect(after[1]).toBe(blocks[0]);
    expect(after[2]).toBe(blocks[2]);
  });
});
