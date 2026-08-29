import {
  codexFileCitationMarkdown,
  resolveCodexFileCitationLink,
} from "@t3tools/client-runtime/codex-file-citations";
import {
  codexArtifactTemplateMarkdown,
  resolveCodexArtifactTemplate,
  type CodexArtifactTemplate,
} from "@t3tools/client-runtime/codex-artifact-templates";
import remarkDirective from "remark-directive";
import remarkParse from "remark-parse";
import { unified } from "unified";

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

interface DirectiveReplacement {
  readonly start: number;
  readonly end: number;
  readonly markdown: string;
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

const directiveParser = unified().use(remarkParse).use(remarkDirective).freeze();

function collectDirectiveReplacements(
  node: MarkdownDirectiveNode,
  replacements: DirectiveReplacement[],
  kinds: CodexDirectiveKinds,
  insideLink = false,
): void {
  if (
    kinds.fileCitations &&
    node.type === "textDirective" &&
    node.name === CODEX_FILE_CITATION_NAME
  ) {
    const citation = resolveCodexFileCitationLink(node.attributes);
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
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
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (!insideLink && template && start !== undefined && end !== undefined) {
      replacements.push({
        start,
        end,
        markdown: `\n\n${codexArtifactTemplateMarkdown(template)}\n\n`,
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

function replaceCodexDirectives(markdown: string, kinds: CodexDirectiveKinds): string {
  const mayContainFileCitation =
    kinds.fileCitations && markdown.includes(`:${CODEX_FILE_CITATION_NAME}`);
  const mayContainArtifactTemplate =
    kinds.artifactTemplates && markdown.includes(`::${CODEX_ARTIFACT_TEMPLATE_NAME}`);
  if (!mayContainFileCitation && !mayContainArtifactTemplate) return markdown;

  const replacements: DirectiveReplacement[] = [];
  collectDirectiveReplacements(
    directiveParser.parse(markdown) as MarkdownDirectiveNode,
    replacements,
    kinds,
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

/** Uses remark's directive grammar to produce links for Markdown renderers without directives. */
export function replaceCodexFileCitationsWithMarkdownLinks(markdown: string): string {
  return replaceCodexDirectives(markdown, {
    artifactTemplates: false,
    fileCitations: true,
  });
}

/** Resolves only the Codex directives T3 knows how to render, leaving every other token literal. */
export function replaceCodexMarkdownDirectives(markdown: string): string {
  return replaceCodexDirectives(markdown, {
    artifactTemplates: true,
    fileCitations: true,
  });
}

/** Splits block cards from Markdown for native renderers that cannot host a view inside text. */
export function splitCodexArtifactTemplateMarkdown(
  markdown: string,
): ReadonlyArray<CodexArtifactTemplateMarkdownSegment> {
  if (!markdown.includes(`::${CODEX_ARTIFACT_TEMPLATE_NAME}`)) {
    return [{ kind: "markdown", markdown, sourceOffset: 0 }];
  }

  const replacements: DirectiveReplacement[] = [];
  collectDirectiveReplacements(
    directiveParser.parse(markdown) as MarkdownDirectiveNode,
    replacements,
    { artifactTemplates: true, fileCitations: false },
  );
  const artifactReplacements = replacements
    .filter(
      (
        replacement,
      ): replacement is DirectiveReplacement & {
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
