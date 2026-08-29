import { describe, expect, it } from "vite-plus/test";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { extractCodexFileCitationHrefs, remarkCodexDirectives } from "./markdown-codex-directives";

interface TestNode {
  readonly type: string;
  readonly value?: string;
  readonly url?: string;
  readonly position?: {
    readonly start: { readonly offset?: number };
    readonly end: { readonly offset?: number };
  };
  readonly data?: {
    readonly hName?: string;
    readonly hProperties?: Readonly<Record<string, unknown>>;
  };
  readonly children?: readonly TestNode[];
}

const ARTIFACT_TEMPLATE_DIRECTIVE =
  '::artifact-template{skill_name="artifact-template-hello-world" skill_directory="/Users/test/.codex/skills/artifact-template-hello-world" display_name="Hello World" artifact_kind="document"}';

async function parseWithCodexDirectives(markdown: string): Promise<TestNode> {
  const processor = unified().use(remarkParse).use(remarkCodexDirectives);
  return (await processor.run(processor.parse(markdown), { value: markdown })) as TestNode;
}

function parseOrdinaryMarkdown(markdown: string): TestNode {
  return unified().use(remarkParse).parse(markdown) as TestNode;
}

describe("remarkCodexDirectives", () => {
  it("turns a file citation into a link AST node without changing source offsets", async () => {
    const directive = ':codex-file-citation{path="/tmp/project/outputs/report.xlsx"}';
    const markdown = `Created ${directive}.`;
    const tree = await parseWithCodexDirectives(markdown);
    const link = tree.children?.[0]?.children?.[1];

    expect(link).toMatchObject({
      type: "link",
      url: "/tmp/project/outputs/report.xlsx",
      children: [{ type: "text", value: "report.xlsx" }],
      position: {
        start: { offset: markdown.indexOf(directive) },
        end: { offset: markdown.indexOf(directive) + directive.length },
      },
    });
  });

  it("turns an artifact template into semantic AST metadata, not a private link", async () => {
    const tree = await parseWithCodexDirectives(ARTIFACT_TEMPLATE_DIRECTIVE);
    const template = tree.children?.[0];

    expect(template).toMatchObject({
      type: "paragraph",
      children: [],
      data: {
        hName: "div",
        hProperties: {
          dataCodexArtifactTemplate: "true",
          dataArtifactKind: "document",
          dataDisplayName: "Hello World",
          dataSkillName: "artifact-template-hello-world",
        },
      },
    });
    expect(template?.url).toBeUndefined();
  });

  it.each([
    "Meeting at 10:30",
    "::note",
    ":::note\ncontent\n:::",
    ':codex-file-citation-extra{path="/tmp/report.xlsx"}',
    "::artifact-template-extra",
  ])("leaves unrelated colon syntax in the ordinary Markdown AST: %s", async (markdown) => {
    expect(await parseWithCodexDirectives(markdown)).toEqual(parseOrdinaryMarkdown(markdown));
  });

  it("restores syntactically valid but unresolved directives as literal AST text", async () => {
    for (const markdown of [
      ':codex-file-citation{purpose="output"}',
      '::artifact-template{skill_name="artifact-template-hello-world"}',
    ]) {
      expect(await parseWithCodexDirectives(markdown)).toEqual(parseOrdinaryMarkdown(markdown));
    }
  });
});

describe("extractCodexFileCitationHrefs", () => {
  it("discovers rendered citations through the same parser pipeline", () => {
    expect(
      extractCodexFileCitationHrefs(
        'Changed :codex-file-citation{path="src/index.ts"} and :codex-file-citation{path="test/index.ts"}.',
      ),
    ).toEqual(["src/index.ts", "test/index.ts"]);
  });

  it("includes citations created by over-indented list recovery", () => {
    expect(
      extractCodexFileCitationHrefs(
        '-       Created :codex-file-citation{path="outputs/report.xlsx"}',
      ),
    ).toEqual(["outputs/report.xlsx"]);
  });

  it("ignores escaped, code, invalid, and nested-link citations", () => {
    const valid = ':codex-file-citation{path="outputs/report.xlsx"}';
    expect(
      extractCodexFileCitationHrefs(
        `\\${valid}\n\n\`${valid}\`\n\n:codex-file-citation{purpose="output"}\n\n[See ${valid}](https://example.com)`,
      ),
    ).toEqual([]);
  });
});
