import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { AssetCreateUrlInput, AttachmentCreateUploadUrlInput } from "./assets.ts";
import {
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "./orchestration.ts";

const isUploadInput = Schema.is(AttachmentCreateUploadUrlInput);

const uploadInput = {
  name: "screenshot.png",
  mimeType: "image/png",
  sizeBytes: 3,
} as const;

describe("AssetCreateUrlInput", () => {
  const isAssetInput = Schema.is(AssetCreateUrlInput);

  it("accepts host media paths only with their thread context", () => {
    const resource = {
      _tag: "media-file",
      threadId: "thread-1",
      path: "/tmp/recording.mp4",
    };
    expect(isAssetInput({ resource })).toBe(true);
    expect(isAssetInput({ resource: { ...resource, path: "images/screenshot.png" } })).toBe(true);
    expect(isAssetInput({ resource: { ...resource, threadId: undefined } })).toBe(false);
    expect(isAssetInput({ resource: { ...resource, path: "" } })).toBe(false);
  });
});

describe("AttachmentCreateUploadUrlInput", () => {
  it("accepts supported image attachments", () => {
    expect(isUploadInput(uploadInput)).toBe(true);
  });

  it("rejects image types that providers do not support", () => {
    expect(isUploadInput({ ...uploadInput, mimeType: "image/svg+xml" })).toBe(false);
  });

  it("accepts generic files without treating them as provider images", () => {
    expect(
      isUploadInput({
        type: "file",
        name: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: PROVIDER_SEND_TURN_MAX_IMAGE_BYTES + 1,
      }),
    ).toBe(true);
    expect(
      isUploadInput({
        type: "file",
        name: "diagram.svg",
        mimeType: "image/svg+xml",
        sizeBytes: 3,
      }),
    ).toBe(true);
  });

  it("rejects empty and oversized uploads", () => {
    expect(isUploadInput({ ...uploadInput, sizeBytes: 0 })).toBe(false);
    expect(
      isUploadInput({ ...uploadInput, sizeBytes: PROVIDER_SEND_TURN_MAX_IMAGE_BYTES + 1 }),
    ).toBe(false);
    expect(
      isUploadInput({
        type: "file",
        name: "archive.zip",
        mimeType: "application/zip",
        sizeBytes: PROVIDER_SEND_TURN_MAX_FILE_BYTES + 1,
      }),
    ).toBe(false);
  });
});
