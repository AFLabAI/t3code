import {
  codexFileCitationMarkdown,
  resolveCodexFileCitationLink,
} from "@t3tools/client-runtime/codex-file-citations";
import {
  resolveCodexArtifactTemplate,
  type CodexArtifactTemplate,
} from "@t3tools/client-runtime/codex-artifact-templates";
import remarkDirective from "remark-directive";
import remarkParse from "remark-parse";
import { unified } from "unified";
import {
  remarkNormalizeListItemIndentation,
  sourceOffsetForRecoveredMarkdownNode,
} from "./markdownListIndentation.js";

const CODEX_FILE_CITATION_NAME = "codex-file-citation";
const CODEX_ARTIFACT_TEMPLATE_NAME = "artifact-template";

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

interface DirectiveMatch {
  readonly start: number;
  readonly end: number;
  readonly markdown?: string;
  readonly artifactTemplate?: CodexArtifactTemplate;
}

export type CodexArtifactTemplateMarkdownSegment =
  | { readonly kind: "markdown"; readonly markdown: string; readonly sourceOffset: number }
  | {
      readonly kind: "artifact-template";
      readonly sourceOffset: number;
      readonly template: CodexArtifactTemplate;
    };

interface CodexDirectiveKinds {
  readonly artifactTemplates: boolean;
  readonly fileCitations: boolean;
}

const directiveParser = unified()
  .use(remarkParse)
  .use(remarkDirective)
  .use(remarkNormalizeListItemIndentation)
  .freeze();

function parseDirectiveMarkdown(markdown: string): MarkdownDirectiveNode {
  return directiveParser.runSync(directiveParser.parse(markdown), {
    value: markdown,
  }) as MarkdownDirectiveNode;
}

function collectDirectiveReplacements(
  node: MarkdownDirectiveNode,
  replacements: DirectiveMatch[],
  kinds: CodexDirectiveKinds,
  insideLink = false,
): void {
  if (
    kinds.fileCitations &&
    node.type === "textDirective" &&
    node.name === CODEX_FILE_CITATION_NAME
  ) {
    const citation = resolveCodexFileCitationLink(node.attributes);
    const parsedStart = node.position?.start.offset;
    const parsedEnd = node.position?.end.offset;
    const start =
      parsedStart === undefined
        ? undefined
        : sourceOffsetForRecoveredMarkdownNode(node, parsedStart);
    const end =
      parsedEnd === undefined ? undefined : sourceOffsetForRecoveredMarkdownNode(node, parsedEnd);
    if (!insideLink && citation && start !== undefined && end !== undefined) {
      replacements.push({ start, end, markdown: codexFileCitationMarkdown(citation) });
    }
    return;
  }

  if (
    kinds.artifactTemplates &&
    node.type === "leafDirective" &&
    node.name === CODEX_ARTIFACT_TEMPLATE_NAME
  ) {
    const template = resolveCodexArtifactTemplate(node.attributes);
    const parsedStart = node.position?.start.offset;
    const parsedEnd = node.position?.end.offset;
    const start =
      parsedStart === undefined
        ? undefined
        : sourceOffsetForRecoveredMarkdownNode(node, parsedStart);
    const end =
      parsedEnd === undefined ? undefined : sourceOffsetForRecoveredMarkdownNode(node, parsedEnd);
    if (!insideLink && template && start !== undefined && end !== undefined) {
      replacements.push({
        start,
        end,
        artifactTemplate: template,
      });
    }
    return;
  }

  const childInsideLink = insideLink || node.type === "link" || node.type === "linkReference";
  for (const child of node.children ?? []) {
    collectDirectiveReplacements(child, replacements, kinds, childInsideLink);
  }
}

/** Uses remark's directive grammar to produce links for Markdown renderers without directives. */
export function replaceCodexFileCitationsWithMarkdownLinks(markdown: string): string {
  if (!markdown.includes(`:${CODEX_FILE_CITATION_NAME}`)) return markdown;

  const matches: DirectiveMatch[] = [];
  collectDirectiveReplacements(parseDirectiveMarkdown(markdown), matches, {
    artifactTemplates: false,
    fileCitations: true,
  });
  let transformed = markdown;
  for (const match of matches.sort((left, right) => right.start - left.start)) {
    if (match.markdown === undefined) continue;
    transformed = transformed.slice(0, match.start) + match.markdown + transformed.slice(match.end);
  }
  return transformed;
}

/** Splits block cards from Markdown for native renderers that cannot host a view inside text. */
export function splitCodexArtifactTemplateMarkdown(
  markdown: string,
): ReadonlyArray<CodexArtifactTemplateMarkdownSegment> {
  if (!markdown.includes(`::${CODEX_ARTIFACT_TEMPLATE_NAME}`)) {
    return [{ kind: "markdown", markdown, sourceOffset: 0 }];
  }

  const replacements: DirectiveMatch[] = [];
  collectDirectiveReplacements(parseDirectiveMarkdown(markdown), replacements, {
    artifactTemplates: true,
    fileCitations: false,
  });
  const artifactReplacements = replacements
    .filter(
      (
        replacement,
      ): replacement is DirectiveMatch & {
        readonly artifactTemplate: CodexArtifactTemplate;
      } => replacement.artifactTemplate !== undefined,
    )
    .sort((left, right) => left.start - right.start);

  if (artifactReplacements.length === 0) {
    return [{ kind: "markdown", markdown, sourceOffset: 0 }];
  }

  const segments: CodexArtifactTemplateMarkdownSegment[] = [];
  let cursor = 0;
  for (const replacement of artifactReplacements) {
    if (replacement.start > cursor) {
      segments.push({
        kind: "markdown",
        markdown: markdown.slice(cursor, replacement.start),
        sourceOffset: cursor,
      });
    }
    segments.push({
      kind: "artifact-template",
      sourceOffset: replacement.start,
      template: replacement.artifactTemplate,
    });
    cursor = replacement.end;
  }
  if (cursor < markdown.length) {
    segments.push({ kind: "markdown", markdown: markdown.slice(cursor), sourceOffset: cursor });
  }
  return segments;
}
