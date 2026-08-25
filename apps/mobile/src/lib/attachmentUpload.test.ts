import {
  EnvironmentId,
  type AttachmentCreateUploadUrlInput,
  type AttachmentCreateUploadUrlResult,
  type UploadChatImageAttachment,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  files: new Map<string, { base64: string; deleted: boolean }>(),
  upload: vi.fn(),
}));

vi.mock("expo-file-system", () => ({
  Paths: { cache: "file:///cache" },
  File: class {
    readonly uri: string;

    constructor(directory: string, name: string) {
      this.uri = `${directory}/${name}`;
    }

    get exists(): boolean {
      return mocks.files.get(this.uri)?.deleted === false;
    }

    write(base64: string, options: { readonly encoding: string }): void {
      expect(options.encoding).toBe("base64");
      mocks.files.set(this.uri, { base64, deleted: false });
    }

    upload(url: string, options: unknown): Promise<{ readonly status: number }> {
      return mocks.upload(url, options, this.uri);
    }

    delete(): void {
      const file = mocks.files.get(this.uri);
      if (file) {
        file.deleted = true;
      }
    }
  },
}));

import { prepareMobileTurnAttachments } from "./attachmentUpload";

const environmentId = EnvironmentId.make("environment-1");

function image(name: string): UploadChatImageAttachment {
  return {
    type: "image",
    name,
    mimeType: "image/png",
    sizeBytes: 3,
    dataUrl: "data:image/png;base64,YWJj",
  };
}

function uploadDependencies() {
  let nextAttachmentId = 0;
  return {
    createUploadUrl: vi.fn(
      async (_input: AttachmentCreateUploadUrlInput): Promise<AttachmentCreateUploadUrlResult> => {
        const attachmentId = `pending-${++nextAttachmentId}`;
        return {
          attachmentId,
          relativeUrl: `/api/attachments/upload/${attachmentId}`,
          expiresAt: Date.now() + 60_000,
        };
      },
    ),
    deleteUpload: vi.fn(async (_attachmentId: string) => undefined),
  };
}

describe("prepareMobileTurnAttachments", () => {
  beforeEach(() => {
    mocks.files.clear();
    mocks.upload.mockReset();
    mocks.upload.mockResolvedValue({ status: 204 });
  });

  it("uploads image bytes to the paired remote environment and sends attachment references", async () => {
    const dependencies = uploadDependencies();
    const images = [image("first.png"), image("second.png")];

    const prepared = await prepareMobileTurnAttachments({
      environmentId,
      httpBaseUrl: "https://remote.example.test/",
      supportsUploads: true,
      attachments: images,
      ...dependencies,
    });

    expect(dependencies.createUploadUrl).toHaveBeenCalledWith({
      name: "first.png",
      mimeType: "image/png",
      sizeBytes: 3,
    });
    expect(mocks.upload).toHaveBeenNthCalledWith(
      1,
      "https://remote.example.test/api/attachments/upload/pending-1",
      { httpMethod: "POST", headers: { "Content-Type": "image/png" } },
      expect.stringMatching(/^file:\/\/\/cache\/t3-attachment-/),
    );
    expect(prepared.attachments).toEqual([
      { type: "image", id: "pending-1", name: "first.png", mimeType: "image/png", sizeBytes: 3 },
      { type: "image", id: "pending-2", name: "second.png", mimeType: "image/png", sizeBytes: 3 },
    ]);
    expect(JSON.stringify(prepared.attachments)).not.toContain("data:image");
    expect(images[0]?.dataUrl).toBe("data:image/png;base64,YWJj");
    expect([...mocks.files.values()]).toEqual([
      { base64: "YWJj", deleted: true },
      { base64: "YWJj", deleted: true },
    ]);

    await prepared.release();
    expect(dependencies.deleteUpload).toHaveBeenCalledWith("pending-1");
    expect(dependencies.deleteUpload).toHaveBeenCalledWith("pending-2");
  });

  it("keeps inline attachments for environments without HTTP upload support", async () => {
    const dependencies = uploadDependencies();
    const images = [image("legacy.png")];

    const prepared = await prepareMobileTurnAttachments({
      environmentId,
      httpBaseUrl: "https://older.example.test/",
      supportsUploads: false,
      attachments: images,
      ...dependencies,
    });

    expect(prepared.attachments).toEqual(images);
    expect(dependencies.createUploadUrl).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("removes pending uploads after a failed request and can retry the original images", async () => {
    const dependencies = uploadDependencies();
    const images = [image("first.png"), image("retry.png")];
    mocks.upload.mockResolvedValueOnce({ status: 204 }).mockResolvedValueOnce({ status: 503 });

    await expect(
      prepareMobileTurnAttachments({
        environmentId,
        httpBaseUrl: "https://remote.example.test/",
        supportsUploads: true,
        attachments: images,
        ...dependencies,
      }),
    ).rejects.toMatchObject({
      _tag: "ConnectionTransientError",
      message: "Could not upload 'retry.png': upload rejected (503).",
    });
    expect(dependencies.deleteUpload).toHaveBeenCalledWith("pending-1");
    expect(dependencies.deleteUpload).toHaveBeenCalledWith("pending-2");

    mocks.upload.mockResolvedValue({ status: 204 });
    const retry = await prepareMobileTurnAttachments({
      environmentId,
      httpBaseUrl: "https://remote.example.test/",
      supportsUploads: true,
      attachments: images,
      ...dependencies,
    });

    expect(retry.attachments).toMatchObject([{ id: "pending-3" }, { id: "pending-4" }]);
  });
});
