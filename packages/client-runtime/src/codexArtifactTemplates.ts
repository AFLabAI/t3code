export const CODEX_ARTIFACT_TEMPLATE_KINDS = [
  "document",
  "presentation",
  "spreadsheet",
  "site",
  "google-docs",
  "google-slides",
  "google-sheets",
  "image",
  "email",
  "slack",
] as const;

export type CodexArtifactTemplateKind = (typeof CODEX_ARTIFACT_TEMPLATE_KINDS)[number];

export const CODEX_ARTIFACT_TEMPLATE_GALLERY_KINDS = ["imagegen", "product-design"] as const;

export type CodexArtifactTemplateGalleryKind =
  (typeof CODEX_ARTIFACT_TEMPLATE_GALLERY_KINDS)[number];

export interface CodexArtifactTemplate {
  readonly artifactKind: CodexArtifactTemplateKind;
  readonly displayName: string;
  readonly galleryKind?: CodexArtifactTemplateGalleryKind;
  readonly skillDirectory: string;
  readonly skillName: string;
}

export type CodexArtifactTemplateAttributes = Readonly<Record<string, string | null | undefined>>;

const CODEX_ARTIFACT_TEMPLATE_MARKDOWN_PROTOCOL = "t3-artifact-template:";
const WINDOWS_DRIVE_PATH_REGEX = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_PATH_REGEX = /^(?:\\\\[^\\]+\\[^\\]+|\/\/[^/]+\/[^/]+)/;

function isCodexArtifactTemplateKind(value: unknown): value is CodexArtifactTemplateKind {
  return CODEX_ARTIFACT_TEMPLATE_KINDS.some((kind) => kind === value);
}

function isCodexArtifactTemplateGalleryKind(
  value: unknown,
): value is CodexArtifactTemplateGalleryKind {
  return CODEX_ARTIFACT_TEMPLATE_GALLERY_KINDS.some((kind) => kind === value);
}

function isAbsoluteSkillDirectory(value: string): boolean {
  return (
    (value.startsWith("/") && !value.startsWith("//")) ||
    WINDOWS_DRIVE_PATH_REGEX.test(value) ||
    WINDOWS_UNC_PATH_REGEX.test(value)
  );
}

/** Mirrors the Codex result-card schema so malformed directives remain literal Markdown. */
export function resolveCodexArtifactTemplate(
  attributes: CodexArtifactTemplateAttributes | null | undefined,
): CodexArtifactTemplate | null {
  const artifactKind = attributes?.artifact_kind;
  const displayNameValue = attributes?.display_name;
  const displayName = typeof displayNameValue === "string" ? displayNameValue.trim() : undefined;
  const galleryKind = attributes?.gallery_kind;
  const skillDirectory = attributes?.skill_directory;
  const skillName = attributes?.skill_name;

  if (
    !isCodexArtifactTemplateKind(artifactKind) ||
    !displayName ||
    typeof skillDirectory !== "string" ||
    !isAbsoluteSkillDirectory(skillDirectory) ||
    typeof skillName !== "string" ||
    !skillName.startsWith("artifact-template-") ||
    (galleryKind !== undefined && !isCodexArtifactTemplateGalleryKind(galleryKind))
  ) {
    return null;
  }

  return {
    artifactKind,
    displayName,
    ...(galleryKind === undefined ? {} : { galleryKind }),
    skillDirectory,
    skillName,
  };
}

function markdownLabel(value: string): string {
  return value.replace(/[\\[\]*_`<&]/g, "\\$&");
}

function attributesForTemplate(template: CodexArtifactTemplate): CodexArtifactTemplateAttributes {
  return {
    artifact_kind: template.artifactKind,
    display_name: template.displayName,
    ...(template.galleryKind === undefined ? {} : { gallery_kind: template.galleryKind }),
    skill_directory: template.skillDirectory,
    skill_name: template.skillName,
  };
}

export function codexArtifactTemplateMarkdownHref(template: CodexArtifactTemplate): string {
  return `${CODEX_ARTIFACT_TEMPLATE_MARKDOWN_PROTOCOL}${encodeURIComponent(JSON.stringify(template))}`;
}

export function codexArtifactTemplateMarkdown(template: CodexArtifactTemplate): string {
  return `[${markdownLabel(template.displayName)}](<${codexArtifactTemplateMarkdownHref(template)}>)`;
}

export function parseCodexArtifactTemplateMarkdownHref(
  href: string | null | undefined,
): CodexArtifactTemplate | null {
  if (!href?.startsWith(CODEX_ARTIFACT_TEMPLATE_MARKDOWN_PROTOCOL)) return null;

  try {
    const decoded: unknown = JSON.parse(
      decodeURIComponent(href.slice(CODEX_ARTIFACT_TEMPLATE_MARKDOWN_PROTOCOL.length)),
    );
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) return null;
    const template = decoded as Partial<CodexArtifactTemplate>;
    return resolveCodexArtifactTemplate(
      attributesForTemplate({
        artifactKind: template.artifactKind as CodexArtifactTemplateKind,
        displayName: template.displayName ?? "",
        ...(template.galleryKind === undefined
          ? {}
          : { galleryKind: template.galleryKind as CodexArtifactTemplateGalleryKind }),
        skillDirectory: template.skillDirectory ?? "",
        skillName: template.skillName ?? "",
      }),
    );
  } catch {
    return null;
  }
}

const USE_PROMPT_BY_KIND: Record<CodexArtifactTemplateKind, (skill: string) => string> = {
  document: (skill) => `Create a document using this ${skill} about…`,
  presentation: (skill) => `Create a presentation using the ${skill} template about…`,
  spreadsheet: (skill) => `Create a spreadsheet using this ${skill} about…`,
  site: (skill) => `Create a Site using this ${skill} about…`,
  "google-docs": (skill) => `Create a Google Doc using this ${skill} about…`,
  "google-slides": (skill) => `Create a Google Slides presentation using this ${skill} about…`,
  "google-sheets": (skill) => `Create a Google Sheet using this ${skill} about…`,
  image: (skill) => `Create an image using this ${skill} of…`,
  email: (skill) => `Draft an email using this ${skill} about…`,
  slack: (skill) => `Draft a Slack message using this ${skill} about…`,
};

export function codexArtifactTemplateUsePrompt(template: CodexArtifactTemplate): string {
  return USE_PROMPT_BY_KIND[template.artifactKind](`$${template.skillName}`);
}

export function appendCodexArtifactTemplateUsePrompt(
  draft: string,
  template: CodexArtifactTemplate,
): string {
  const prompt = codexArtifactTemplateUsePrompt(template);
  const trimmedDraft = draft.trimEnd();
  const promptStart = trimmedDraft.length - prompt.length;
  const alreadyEndsWithPrompt =
    promptStart >= 0 &&
    trimmedDraft.slice(promptStart) === prompt &&
    (promptStart === 0 || /\s/.test(trimmedDraft[promptStart - 1] ?? ""));

  if (alreadyEndsWithPrompt) {
    return draft;
  }

  const needsLeadingSpace = draft.length > 0 && !/\s$/.test(draft);
  return `${draft}${needsLeadingSpace ? " " : ""}${prompt}`;
}
