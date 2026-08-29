import { codexArtifactTemplateCopyText } from "./codexArtifactTemplates.js";
import {
  replaceCodexFileCitationsWithMarkdownLinks,
  splitCodexArtifactTemplateMarkdown,
  type CodexArtifactTemplateMarkdownSegment,
} from "./codexFileCitationMarkdown.js";

export { splitCodexArtifactTemplateMarkdown, type CodexArtifactTemplateMarkdownSegment };

/** Produces portable text for copy surfaces from parser-confirmed Codex directives. */
export function codexMarkdownForCopy(markdown: string): string {
  return splitCodexArtifactTemplateMarkdown(markdown)
    .map((segment) =>
      segment.kind === "artifact-template"
        ? codexArtifactTemplateCopyText(segment.template)
        : replaceCodexFileCitationsWithMarkdownLinks(segment.markdown),
    )
    .join("");
}
