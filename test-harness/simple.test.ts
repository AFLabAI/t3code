import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert";

NodeTest.describe("Node built-in test runner", () => {
  NodeTest.it("should run assertions", () => {
    NodeAssert.default.strictEqual(1 + 1, 2);
  });

  NodeTest.it("should support describe/it nesting", () => {
    const result = true;
    NodeAssert.default.ok(result);
  });
});
