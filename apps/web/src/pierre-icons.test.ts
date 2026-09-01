import { assert, describe, it } from "vite-plus/test";

import {
  hasSpecificPierreIconForFileName,
  resolvePierreIconForEntry,
  syntheticFileNameForLanguageId,
  T3_PIERRE_ICONS,
} from "./pierre-icons";

describe("Pierre file icons", () => {
  it("uses Pierre exact filename and complete-set extension mappings", () => {
    assert.equal(resolvePierreIconForEntry("Dockerfile", "file")?.token, "docker");
    assert.equal(resolvePierreIconForEntry("src/Button.tsx", "file")?.token, "react");
    assert.equal(resolvePierreIconForEntry("vite.config.ts", "file")?.token, "vite");
  });

  it("extends Pierre with T3-specific exact filename icons", () => {
    assert.equal(
      resolvePierreIconForEntry("package.json", "file")?.name,
      "t3-file-icon-package-json",
    );
    assert.equal(
      resolvePierreIconForEntry("config/tsconfig.json", "file")?.name,
      "t3-file-icon-tsconfig",
    );
    assert.equal(resolvePierreIconForEntry("AGENTS.md", "file")?.name, "t3-file-icon-agents");
    assert.equal(resolvePierreIconForEntry("CLAUDE.md", "file")?.name, "t3-file-icon-claude");
    assert.equal(resolvePierreIconForEntry("README.md", "file")?.name, "t3-file-icon-readme");
    assert.equal(resolvePierreIconForEntry("pnpm-lock.yaml", "file")?.name, "t3-file-icon-pnpm");
    assert.equal(
      resolvePierreIconForEntry("pnpm-workspace.yaml", "file")?.name,
      "t3-file-icon-pnpm",
    );
  });

  it("ships every custom icon referenced by the extended resolver", () => {
    const customIconNames = new Set([
      ...Object.values(T3_PIERRE_ICONS.byFileName),
      ...Object.values(T3_PIERRE_ICONS.byFileExtension),
    ]);
    for (const iconName of customIconNames) {
      assert.include(T3_PIERRE_ICONS.spriteSheet, `id="${iconName}"`);
    }
  });

  it.each(["avi", "m4v", "mkv", "mov", "mp4", "ogv", "webm"])(
    "uses the video icon for %s files",
    (extension) => {
      const fileName = `/tmp/recording.${extension}`;
      assert.equal(resolvePierreIconForEntry(fileName, "file")?.name, "t3-file-icon-video");
      assert.isTrue(hasSpecificPierreIconForFileName(fileName));
    },
  );

  it("recognizes video extensions in literal paths without treating names as URLs", () => {
    for (const path of [
      "recording.MP4",
      "/tmp/recording #2.mp4",
      "/tmp/recording?.mp4",
      "/tmp/recording%20.mp4",
      "C:\\Users\\test\\Downloads\\recording.MOV",
    ]) {
      assert.equal(resolvePierreIconForEntry(path, "file")?.name, "t3-file-icon-video");
    }
    assert.equal(resolvePierreIconForEntry("recording.mp4.txt", "file")?.token, "text");
    assert.isNull(resolvePierreIconForEntry("recordings.mp4", "directory"));
  });

  it("uses the Pierre default icon for unknown file types", () => {
    assert.equal(resolvePierreIconForEntry("artifact.unknown-ext", "file")?.token, "default");
    assert.isFalse(hasSpecificPierreIconForFileName("artifact.unknown-ext"));
  });

  it("leaves directory rendering to the shared folder fallback", () => {
    assert.isNull(resolvePierreIconForEntry("packages/client-runtime", "directory"));
  });

  it("normalizes common markdown fence language aliases", () => {
    assert.equal(syntheticFileNameForLanguageId("typescript"), "file.ts");
    assert.equal(syntheticFileNameForLanguageId("shellscript"), "file.sh");
    assert.equal(syntheticFileNameForLanguageId("python"), "file.py");
  });
});
