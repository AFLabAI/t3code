import { describe, expect, it } from "vite-plus/test";

import { replaceCodexFileCitationsWithMarkdownLinks } from "./codexFileCitationMarkdown.js";

const OUTPUT_CITATION =
  ':codex-file-citation{path="/workspace/outputs/issue-2387-sparse-diagonal.xlsx" purpose="output"}';

describe("replaceCodexFileCitationsWithMarkdownLinks", () => {
  it("turns directives into portable links", () => {
    expect(replaceCodexFileCitationsWithMarkdownLinks(`Created ${OUTPUT_CITATION}.`)).toBe(
      "Created [issue-2387-sparse-diagonal.xlsx](</workspace/outputs/issue-2387-sparse-diagonal.xlsx>).",
    );
  });

  it("supports multiple citations and line ranges", () => {
    const sourceCitation =
      ':codex-file-citation{path="src/main.ts" line_range_start="5" line_range_end="9"}';
    expect(
      replaceCodexFileCitationsWithMarkdownLinks(
        `**Files:** ${OUTPUT_CITATION} and ${sourceCitation}`,
      ),
    ).toBe(
      "**Files:** [issue-2387-sparse-diagonal.xlsx](</workspace/outputs/issue-2387-sparse-diagonal.xlsx>) and [main.ts](<src/main.ts#L5>)",
    );
  });

  it("leaves escaped citations literal", () => {
    const markdown = `\\${OUTPUT_CITATION}`;
    expect(replaceCodexFileCitationsWithMarkdownLinks(markdown)).toBe(markdown);
  });

  it("leaves inline and fenced code literal", () => {
    const markdown = `Inline \`${OUTPUT_CITATION}\`\n\n\`\`\`text\n${OUTPUT_CITATION}\n\`\`\``;
    expect(replaceCodexFileCitationsWithMarkdownLinks(markdown)).toBe(markdown);
  });

  it("leaves malformed and unfinished citations literal", () => {
    const markdown = 'Created :codex-file-citation{path="/workspace/outputs/report.xlsx"';
    expect(replaceCodexFileCitationsWithMarkdownLinks(markdown)).toBe(markdown);
  });

  it("keeps Markdown punctuation in filenames literal", () => {
    const citation = ':codex-file-citation{path="reports/*draft*_`copy`.txt"}';
    expect(replaceCodexFileCitationsWithMarkdownLinks(citation)).toBe(
      "[\\*draft\\*\\_\\`copy\\`.txt](<reports/*draft*_`copy`.txt>)",
    );
  });

  it("leaves citations inside existing links literal", () => {
    const markdown = `[See ${OUTPUT_CITATION}](https://example.com)`;
    expect(replaceCodexFileCitationsWithMarkdownLinks(markdown)).toBe(markdown);
  });
});
