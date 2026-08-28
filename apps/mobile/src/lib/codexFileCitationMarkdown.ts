import { replaceCodexFileCitationsWithMarkdownLinks } from "@t3tools/client-runtime/codex-file-citation-markdown";
import type { MarkdownPlugin } from "react-native-nitro-markdown";

const CODEX_FILE_CITATION_MARKDOWN_PLUGIN: MarkdownPlugin = {
  name: "codex-file-citations",
  beforeParse: replaceCodexFileCitationsWithMarkdownLinks,
};

export const CODEX_FILE_CITATION_MARKDOWN_PLUGINS: MarkdownPlugin[] = [
  CODEX_FILE_CITATION_MARKDOWN_PLUGIN,
];

export { replaceCodexFileCitationsWithMarkdownLinks };
