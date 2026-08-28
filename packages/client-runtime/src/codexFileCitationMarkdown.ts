import {
  codexFileCitationMarkdown,
  resolveCodexFileCitationLink,
} from "@t3tools/client-runtime/codex-file-citations";
import remarkDirective from "remark-directive";
import remarkParse from "remark-parse";
import { unified } from "unified";

const CODEX_FILE_CITATION_NAME = "codex-file-citation";

interface MarkdownPosition {
  readonly start: { readonly offset?: number };
  readonly end: { readonly offset?: number };
}

interface MarkdownDirectiveNode {
  readonly type?: string;
  readonly name?: string;
  readonly attributes?: Readonly<Record<string, string | null>>;
  readonly position?: MarkdownPosition;
  readonly children?: ReadonlyArray<MarkdownDirectiveNode>;
}

interface CitationReplacement {
  readonly start: number;
  readonly end: number;
  readonly markdown: string;
}

const citationParser = unified().use(remarkParse).use(remarkDirective).freeze();

function collectCitationReplacements(
  node: MarkdownDirectiveNode,
  replacements: CitationReplacement[],
): void {
  if (node.type === "textDirective" && node.name === CODEX_FILE_CITATION_NAME) {
    const citation = resolveCodexFileCitationLink(node.attributes);
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (citation && start !== undefined && end !== undefined) {
      replacements.push({ start, end, markdown: codexFileCitationMarkdown(citation) });
    }
    return;
  }

  for (const child of node.children ?? []) {
    collectCitationReplacements(child, replacements);
  }
}

/** Uses remark's directive grammar to produce links for Markdown renderers without directives. */
export function replaceCodexFileCitationsWithMarkdownLinks(markdown: string): string {
  if (!markdown.includes(`:${CODEX_FILE_CITATION_NAME}`)) return markdown;

  const replacements: CitationReplacement[] = [];
  collectCitationReplacements(
    citationParser.parse(markdown) as MarkdownDirectiveNode,
    replacements,
  );

  let transformed = markdown;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    transformed =
      transformed.slice(0, replacement.start) +
      replacement.markdown +
      transformed.slice(replacement.end);
  }
  return transformed;
}
