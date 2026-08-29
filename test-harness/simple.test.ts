import { describe, it } from "node:test";
import assert from "node:assert";

describe("Node built-in test runner", () => {
  it("should run assertions", () => {
    assert.strictEqual(1 + 1, 2);
  });

  it("should support describe/it nesting", () => {
    const result = true;
    assert.ok(result);
  });
});
