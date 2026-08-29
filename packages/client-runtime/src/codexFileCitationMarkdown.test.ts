import { describe, expect, it } from "vite-plus/test";

import {
  replaceCodexFileCitationsWithMarkdownLinks,
  splitCodexArtifactTemplateMarkdown,
} from "./codexFileCitationMarkdown.js";

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

  it("turns citations in over-indented list recovery into portable links", () => {
    expect(replaceCodexFileCitationsWithMarkdownLinks(`-       Created ${OUTPUT_CITATION}`)).toBe(
      "-       Created [issue-2387-sparse-diagonal.xlsx](</workspace/outputs/issue-2387-sparse-diagonal.xlsx>)",
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

const ARTIFACT_TEMPLATE_DIRECTIVE =
  '::artifact-template{skill_name="artifact-template-hello-world" skill_directory="/Users/test/.codex/skills/artifact-template-hello-world" display_name="Hello World" artifact_kind="document"}';

describe("splitCodexArtifactTemplateMarkdown", () => {
  it("keeps the file-citation-only compatibility helper narrowly scoped", () => {
    expect(replaceCodexFileCitationsWithMarkdownLinks(ARTIFACT_TEMPLATE_DIRECTIVE)).toBe(
      ARTIFACT_TEMPLATE_DIRECTIVE,
    );
  });

  it("splits block cards from the surrounding native Markdown", () => {
    const source = `Before.\n\n${ARTIFACT_TEMPLATE_DIRECTIVE}\n\nAfter ${OUTPUT_CITATION}.`;
    expect(splitCodexArtifactTemplateMarkdown(source)).toEqual([
      { kind: "markdown", markdown: "Before.\n\n", sourceOffset: 0 },
      {
        kind: "artifact-template",
        sourceOffset: "Before.\n\n".length,
        template: {
          artifactKind: "document",
          displayName: "Hello World",
          skillDirectory: "/Users/test/.codex/skills/artifact-template-hello-world",
          skillName: "artifact-template-hello-world",
        },
      },
      {
        kind: "markdown",
        markdown: `\n\nAfter ${OUTPUT_CITATION}.`,
        sourceOffset: "Before.\n\n".length + ARTIFACT_TEMPLATE_DIRECTIVE.length,
      },
    ]);
  });

  it("does not split malformed directives or code examples", () => {
    const code = `\`${ARTIFACT_TEMPLATE_DIRECTIVE}\``;
    const malformed = '::artifact-template{display_name="Hello World"}';
    expect(splitCodexArtifactTemplateMarkdown(code)).toEqual([
      { kind: "markdown", markdown: code, sourceOffset: 0 },
    ]);
    expect(splitCodexArtifactTemplateMarkdown(malformed)).toEqual([
      { kind: "markdown", markdown: malformed, sourceOffset: 0 },
    ]);
  });
});
