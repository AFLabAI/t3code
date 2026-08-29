import { describe, expect, it } from "vite-plus/test";

import {
  CODEX_FILE_CITATION_MARKDOWN_PLUGINS,
  codexMarkdownForCopy,
} from "./codexFileCitationMarkdown";

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

  it("transforms citations in recovered over-indented list items", () => {
    const transform = CODEX_FILE_CITATION_MARKDOWN_PLUGINS[0]?.beforeParse;
    const directive = ':codex-file-citation{path="outputs/report.xlsx"}';

    expect(transform?.(`-       Created ${directive}`)).toBe(
      "-       Created [report.xlsx](<outputs/report.xlsx>)",
    );
  });

  it("copies artifact template cards as their visible presentation text", () => {
    expect(
      codexMarkdownForCopy(
        '::artifact-template{skill_name="artifact-template-hello-world" skill_directory="/Users/test/.codex/skills/artifact-template-hello-world" display_name="Hello World" artifact_kind="document"}',
      ),
    ).toBe("Hello World (Document template)");
  });
});
