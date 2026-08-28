import { describe, expect, it } from "vite-plus/test";

import { CODEX_FILE_CITATION_MARKDOWN_PLUGINS } from "./codexFileCitationMarkdown";

describe("Codex file citation Nitro Markdown plugin", () => {
  it("uses the parser-backed citation transformer before Nitro parses", () => {
    const transform = CODEX_FILE_CITATION_MARKDOWN_PLUGINS[0]?.beforeParse;
    const directive = ':codex-file-citation{path="src/main.ts" line_range_start="5"}';

    expect(transform?.(`Source: ${directive}`)).toBe("Source: [main.ts](<src/main.ts#L5>)");
  });
});
