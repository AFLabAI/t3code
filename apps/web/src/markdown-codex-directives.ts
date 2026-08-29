import {
  resolveCodexArtifactTemplate,
  type CodexArtifactTemplate,
} from "@t3tools/client-runtime/codex-artifact-templates";
import { resolveCodexFileCitationLink } from "@t3tools/client-runtime/codex-file-citations";
import { directiveFromMarkdown } from "mdast-util-directive";
import { directive } from "micromark-extension-directive";
import {
  markdownLineEnding,
  unicodePunctuation,
  unicodeWhitespace,
} from "micromark-util-character";
import type { Construct, Extension, Tokenizer } from "micromark-util-types";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified, type Processor } from "unified";
import {
  remarkNormalizeListItemIndentation,
  sourceForRecoveredMarkdownNode,
} from "./markdown-list-indentation";

const COLON = 58;
const DASH = 45;
const UNDERSCORE = 95;
const CODEX_FILE_CITATION_NAME = "codex-file-citation";
const CODEX_ARTIFACT_TEMPLATE_NAME = "artifact-template";

export const CODEX_ARTIFACT_TEMPLATE_HAST_PROPERTIES = [
  "dataCodexArtifactTemplate",
  "dataArtifactKind",
  "dataDisplayName",
  "dataGalleryKind",
  "dataSkillDirectory",
  "dataSkillName",
] as const;

interface MarkdownPosition {
  readonly start: { readonly offset?: number };
  readonly end: { readonly offset?: number };
}

interface MarkdownAstNode {
  type?: string;
  name?: string;
  value?: string;
  url?: string;
  attributes?: Readonly<Record<string, string | null>>;
  position?: MarkdownPosition;
  data?: {
    codexFileCitation?: true;
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
  children?: MarkdownAstNode[];
}

interface MarkdownFile {
  readonly value: unknown;
}

function asConstruct(value: Construct | Construct[] | undefined, label: string): Construct {
  const construct = Array.isArray(value) ? value[0] : value;
  if (!construct) throw new Error(`Missing ${label} directive construct`);
  return construct;
}

function directiveNameEnds(code: number | null): boolean {
  return (
    code === null ||
    markdownLineEnding(code) ||
    unicodeWhitespace(code) ||
    (unicodePunctuation(code) && code !== DASH && code !== UNDERSCORE)
  );
}

function directiveNameGate(markerCount: number, name: string): Construct {
  const tokenize: Tokenizer = (effects, ok, nok) => {
    let markerIndex = 0;
    let nameIndex = 0;

    return marker;

    function marker(code: number | null) {
      if (code !== COLON) return nok(code);
      if (markerIndex === 0) effects.enter("data");
      effects.consume(code);
      markerIndex += 1;
      return markerIndex === markerCount ? nameCharacter : marker;
    }

    function nameCharacter(code: number | null) {
      if (code !== name.charCodeAt(nameIndex)) return nok(code);
      effects.consume(code);
      nameIndex += 1;
      return nameIndex === name.length ? afterName : nameCharacter;
    }

    function afterName(code: number | null) {
      effects.exit("data");
      return directiveNameEnds(code) ? ok(code) : nok(code);
    }
  };

  return { partial: true, tokenize };
}

function restrictDirectiveConstruct(
  construct: Construct,
  markerCount: number,
  name: string,
): Construct {
  const gate = directiveNameGate(markerCount, name);
  return {
    ...construct,
    tokenize(effects, ok, nok) {
      return effects.check(gate, construct.tokenize.call(this, effects, ok, nok), nok);
    },
  };
}

/** Only activates directive grammar for the two Codex tokens T3 renders. */
function codexDirectiveSyntax(): Extension {
  const genericDirectiveSyntax = directive();
  const textDirective = asConstruct(genericDirectiveSyntax.text?.[COLON], CODEX_FILE_CITATION_NAME);
  const flowDirectives = genericDirectiveSyntax.flow?.[COLON];
  const leafDirective = Array.isArray(flowDirectives)
    ? flowDirectives.find((construct) => construct.concrete !== true)
    : flowDirectives;
  if (!leafDirective) {
    throw new Error(`Missing ${CODEX_ARTIFACT_TEMPLATE_NAME} directive construct`);
  }

  return {
    text: {
      [COLON]: restrictDirectiveConstruct(textDirective, 1, CODEX_FILE_CITATION_NAME),
    },
    flow: {
      [COLON]: restrictDirectiveConstruct(leafDirective, 2, CODEX_ARTIFACT_TEMPLATE_NAME),
    },
  };
}

const CODEX_DIRECTIVE_SYNTAX = codexDirectiveSyntax();
const CODEX_DIRECTIVE_FROM_MARKDOWN = directiveFromMarkdown();

function sourceForNode(node: MarkdownAstNode, source: string): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  const nodeSource = sourceForRecoveredMarkdownNode(node) ?? source;
  return start === undefined || end === undefined ? "" : nodeSource.slice(start, end);
}

function restoreTextDirective(node: MarkdownAstNode, source: string): void {
  node.type = "text";
  node.value = sourceForNode(node, source) || `:${node.name ?? ""}`;
  delete node.name;
  delete node.attributes;
  delete node.url;
  delete node.data;
  delete node.children;
}

function restoreLeafDirective(node: MarkdownAstNode, source: string): void {
  const value = sourceForNode(node, source) || `::${node.name ?? ""}`;
  node.type = "paragraph";
  node.children = [
    { type: "text", value, ...(node.position === undefined ? {} : { position: node.position }) },
  ];
  delete node.name;
  delete node.attributes;
  delete node.value;
  delete node.url;
  delete node.data;
}

function renderFileCitation(node: MarkdownAstNode, insideLink: boolean, source: string): void {
  const citation = resolveCodexFileCitationLink(node.attributes);
  if (insideLink || !citation) {
    restoreTextDirective(node, source);
    return;
  }

  node.type = "link";
  node.url = citation.href;
  node.children = [{ type: "text", value: citation.label }];
  node.data = { codexFileCitation: true };
  delete node.name;
  delete node.attributes;
  delete node.value;
}

function renderArtifactTemplate(node: MarkdownAstNode, source: string): void {
  const template = resolveCodexArtifactTemplate(node.attributes);
  if (!template) {
    restoreLeafDirective(node, source);
    return;
  }

  node.type = "paragraph";
  node.children = [];
  node.data = {
    hName: "div",
    hProperties: {
      dataCodexArtifactTemplate: "true",
      dataArtifactKind: template.artifactKind,
      dataDisplayName: template.displayName,
      ...(template.galleryKind === undefined ? {} : { dataGalleryKind: template.galleryKind }),
      dataSkillDirectory: template.skillDirectory,
      dataSkillName: template.skillName,
    },
  };
  delete node.name;
  delete node.attributes;
  delete node.value;
  delete node.url;
}

function transformCodexDirectives(node: MarkdownAstNode, source: string, insideLink = false): void {
  if (node.type === "textDirective" && node.name === CODEX_FILE_CITATION_NAME) {
    renderFileCitation(node, insideLink, source);
    return;
  }
  if (node.type === "leafDirective" && node.name === CODEX_ARTIFACT_TEMPLATE_NAME) {
    renderArtifactTemplate(node, source);
    return;
  }

  const childrenInsideLink = insideLink || node.type === "link" || node.type === "linkReference";
  for (const child of node.children ?? []) {
    transformCodexDirectives(child, source, childrenInsideLink);
  }
}

/** Parses and transforms supported Codex directives without changing ordinary directive grammar. */
export function remarkCodexDirectives(this: Processor) {
  const data = this.data();
  const micromarkExtensions = data.micromarkExtensions ?? (data.micromarkExtensions = []);
  const fromMarkdownExtensions = data.fromMarkdownExtensions ?? (data.fromMarkdownExtensions = []);
  micromarkExtensions.push(CODEX_DIRECTIVE_SYNTAX);
  fromMarkdownExtensions.push(CODEX_DIRECTIVE_FROM_MARKDOWN);

  return (tree: unknown, file: MarkdownFile) => {
    transformCodexDirectives(tree as MarkdownAstNode, String(file.value));
  };
}

const codexFileCitationParser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkNormalizeListItemIndentation)
  .use(remarkCodexDirectives)
  .freeze();

export function extractCodexFileCitationHrefs(markdown: string): ReadonlyArray<string> {
  if (!markdown.includes(`:${CODEX_FILE_CITATION_NAME}`)) return [];

  const tree = codexFileCitationParser.runSync(codexFileCitationParser.parse(markdown), {
    value: markdown,
  }) as MarkdownAstNode;
  const hrefs: string[] = [];
  const visit = (node: MarkdownAstNode) => {
    if (node.type === "link" && node.data?.codexFileCitation === true && node.url !== undefined) {
      hrefs.push(node.url);
      return;
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  visit(tree);
  return hrefs;
}

export function artifactTemplateFromHastProperties(
  properties: Readonly<Record<string, unknown>> | null | undefined,
): CodexArtifactTemplate | null {
  if (properties?.dataCodexArtifactTemplate !== "true") return null;
  const stringProperty = (name: string) => {
    const value = properties[name];
    return typeof value === "string" ? value : undefined;
  };
  return resolveCodexArtifactTemplate({
    artifact_kind: stringProperty("dataArtifactKind"),
    display_name: stringProperty("dataDisplayName"),
    gallery_kind: stringProperty("dataGalleryKind"),
    skill_directory: stringProperty("dataSkillDirectory"),
    skill_name: stringProperty("dataSkillName"),
  });
}
