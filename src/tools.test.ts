import { describe, it, expect } from "vitest";
import { toolDefinitions } from "@barry-rocks/sdk/tools";
import * as tools from "./tools.js";

const allTools = toolDefinitions(tools);

describe("tool exports", () => {
  it("exports at least one tool", () => {
    expect(allTools.length).toBeGreaterThan(0);
  });

  for (const tool of allTools) {
    describe(tool.name, () => {
      it("has required fields", () => {
        expect(tool.name).toBeTruthy();
        expect(tool.namespace).toBeTruthy();
        expect(typeof tool.handler).toBe("function");
        expect(tool.description).toBeTruthy();
      });
    });
  }
});
