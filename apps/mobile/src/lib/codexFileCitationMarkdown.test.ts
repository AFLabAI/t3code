import { describe, expect, it } from "vite-plus/test";

import { CODEX_FILE_CITATION_MARKDOWN_PLUGINS } from "./codexFileCitationMarkdown";

describe("Codex file citation Nitro Markdown plugin", () => {
  it("uses the parser-backed citation transformer before Nitro parses", () => {
    const transform = CODEX_FILE_CITATION_MARKDOWN_PLUGINS[0]?.beforeParse;
    const directive = ':codex-file-citation{path="src/main.ts" line_range_start="5"}';

    expect(transform?.(`Source: ${directive}`)).toBe("Source: [main.ts](<src/main.ts#L5>)");
  });

  it("escapes filename syntax and preserves literal URL delimiters", () => {
    const transform = CODEX_FILE_CITATION_MARKDOWN_PLUGINS[0]?.beforeParse;
    const directive = ':codex-file-citation{path="reports/*draft* #1?.txt" line_range_start="5"}';

    expect(transform?.(directive)).toBe("[\\*draft\\* #1?.txt](<reports/*draft* %231%3F.txt#L5>)");
  });
});
