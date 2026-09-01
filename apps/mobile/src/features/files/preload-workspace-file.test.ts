import { EnvironmentId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(() => ({ query: "read-file" })),
  executeQuery: vi.fn(),
  prepareDocument: vi.fn((contents: string) => ({ contents })),
  highlight: vi.fn(() => ({ query: "highlight" })),
}));

vi.mock("../../state/atom-registry", () => ({ appAtomRegistry: {} }));
vi.mock("../../state/projects", () => ({ projectEnvironment: { readFile: mocks.readFile } }));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({ executeAtomQuery: mocks.executeQuery }));
vi.mock("./source-file-document", () => ({ prepareSourceFileDocument: mocks.prepareDocument }));
vi.mock("./sourceHighlightingState", () => ({ sourceHighlightAtom: mocks.highlight }));

import { preloadWorkspaceFileContents } from "./preload-workspace-file";

const input = {
  cwd: "/repo",
  environmentId: EnvironmentId.make("environment-1"),
  theme: "light" as const,
};

beforeEach(() => vi.clearAllMocks());

describe("preloadWorkspaceFileContents", () => {
  it.each([
    "clips/demo.mp4",
    "clips/demo.MOV",
    "clips/demo#draft?.webm",
    "assets/icon.png",
    "index.html",
    "report.pdf",
  ])("does not read or highlight preview bytes for %s", (relativePath) => {
    preloadWorkspaceFileContents({ ...input, relativePath });
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.executeQuery).not.toHaveBeenCalled();
    expect(mocks.highlight).not.toHaveBeenCalled();
  });

  it("still reads and prepares source files", async () => {
    const highlighted = Promise.withResolvers<void>();
    mocks.executeQuery.mockImplementation(async (_registry, query: { query: string }) => {
      if (query.query === "read-file") {
        return { _tag: "Success", value: { contents: "export const value = 1;" } };
      }
      highlighted.resolve();
      return { _tag: "Success", value: [] };
    });

    preloadWorkspaceFileContents({ ...input, relativePath: "src/main.ts" });
    await highlighted.promise;

    expect(mocks.readFile).toHaveBeenCalledWith({
      environmentId: input.environmentId,
      input: { cwd: "/repo", relativePath: "src/main.ts" },
    });
    expect(mocks.highlight).toHaveBeenCalledWith({
      path: "src/main.ts",
      contents: "export const value = 1;",
      theme: "light",
    });
  });
});
