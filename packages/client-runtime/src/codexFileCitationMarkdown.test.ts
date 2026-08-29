import { describe, expect, it } from "vite-plus/test";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { parseCodexArtifactTemplateMarkdownHref } from "./codexArtifactTemplates.js";
import {
  replaceCodexFileCitationsWithMarkdownLinks,
  replaceCodexMarkdownDirectives,
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

describe("replaceCodexMarkdownDirectives", () => {
  it("turns a valid artifact-template leaf directive into a private Markdown link", () => {
    const transformed = replaceCodexMarkdownDirectives(ARTIFACT_TEMPLATE_DIRECTIVE);
    const href = /^\[Hello World\]\(<(.+)>\)$/.exec(transformed.trim())?.[1];

    expect(href).toBeDefined();
    expect(parseCodexArtifactTemplateMarkdownHref(href)).toEqual({
      artifactKind: "document",
      displayName: "Hello World",
      skillDirectory: "/Users/test/.codex/skills/artifact-template-hello-world",
      skillName: "artifact-template-hello-world",
    });
  });

  it("resolves file citations and artifact-template cards in one parser pass", () => {
    const transformed = replaceCodexMarkdownDirectives(
      `${OUTPUT_CITATION}\n\n${ARTIFACT_TEMPLATE_DIRECTIVE}`,
    );

    expect(transformed).toContain("[issue-2387-sparse-diagonal.xlsx]");
    expect(transformed).toContain("t3-artifact-template:");
  });

  it("keeps artifact-template replacements in their own Markdown blocks", () => {
    const transformed = replaceCodexMarkdownDirectives(
      `${ARTIFACT_TEMPLATE_DIRECTIVE}\nFollowing prose\n${ARTIFACT_TEMPLATE_DIRECTIVE}`,
    );
    const tree = unified().use(remarkParse).parse(transformed);

    expect(tree).toMatchObject({
      children: [
        { type: "paragraph", children: [{ type: "link" }] },
        { type: "paragraph", children: [{ type: "text", value: "Following prose" }] },
        { type: "paragraph", children: [{ type: "link" }] },
      ],
    });
  });

  it.each([
    '::artifact-template{skill_name="artifact-template-hello-world"}',
    '::artifact-template{skill_name="hello-world" skill_directory="/templates/hello-world" display_name="Hello World" artifact_kind="document"}',
    '::artifact-template{skill_name="artifact-template-hello-world" skill_directory="relative/template" display_name="Hello World" artifact_kind="document"}',
    '::artifact-template{skill_name="artifact-template-hello-world" skill_directory="/templates/hello-world" display_name="Hello World" artifact_kind="unknown"}',
    "::note",
  ])("leaves invalid or unknown leaf directives literal: %s", (markdown) => {
    expect(replaceCodexMarkdownDirectives(markdown)).toBe(markdown);
  });

  it("leaves artifact-template examples in escaped text and code literal", () => {
    const markdown = `\\${ARTIFACT_TEMPLATE_DIRECTIVE}\n\n\`${ARTIFACT_TEMPLATE_DIRECTIVE}\`\n\n\`\`\`text\n${ARTIFACT_TEMPLATE_DIRECTIVE}\n\`\`\``;
    expect(replaceCodexMarkdownDirectives(markdown)).toBe(markdown);
  });

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
