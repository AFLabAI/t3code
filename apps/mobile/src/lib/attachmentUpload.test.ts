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

import { prepareMobileTurnAttachments, releaseMobileTurnAttachments } from "./attachmentUpload";

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
      {
        httpMethod: "POST",
        headers: { "Content-Type": "image/png" },
        signal: expect.any(AbortSignal),
      },
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

  it("uses the encoded image size when picker metadata reports a different size", async () => {
    const dependencies = uploadDependencies();

    const prepared = await prepareMobileTurnAttachments({
      environmentId,
      httpBaseUrl: "https://remote.example.test/",
      supportsUploads: true,
      attachments: [{ ...image("picked.png"), sizeBytes: 12 }],
      ...dependencies,
    });

    expect(dependencies.createUploadUrl).toHaveBeenCalledWith({
      name: "picked.png",
      mimeType: "image/png",
      sizeBytes: 3,
    });
    expect(prepared.attachments).toMatchObject([{ sizeBytes: 3 }]);
  });

  it("requires an updated environment instead of sending inline attachments", async () => {
    const dependencies = uploadDependencies();
    const images = [image("legacy.png")];

    await expect(
      prepareMobileTurnAttachments({
        environmentId,
        httpBaseUrl: "https://older.example.test/",
        supportsUploads: false,
        attachments: images,
        ...dependencies,
      }),
    ).rejects.toMatchObject({
      _tag: "ConnectionBlockedError",
      message: "Image attachments require an updated environment.",
    });
    expect(dependencies.createUploadUrl).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("retries while environment upload capabilities are still loading", async () => {
    const dependencies = uploadDependencies();

    await expect(
      prepareMobileTurnAttachments({
        environmentId,
        httpBaseUrl: "https://remote.example.test/",
        supportsUploads: null,
        attachments: [image("waiting.png")],
        ...dependencies,
      }),
    ).rejects.toMatchObject({
      _tag: "ConnectionTransientError",
      message: "Environment upload capabilities are still loading.",
    });
    expect(dependencies.createUploadUrl).not.toHaveBeenCalled();
  });

  it.each([
    {
      attachment: { ...image("unsupported.png"), mimeType: "image/tiff" },
      message: "Could not upload 'unsupported.png': image type is not supported.",
    },
    {
      attachment: { ...image("invalid.png"), dataUrl: "not-a-data-url" },
      message: "Could not upload 'invalid.png': image data is invalid.",
    },
  ])("does not retry invalid image attachments", async ({ attachment, message }) => {
    const dependencies = uploadDependencies();

    await expect(
      prepareMobileTurnAttachments({
        environmentId,
        httpBaseUrl: "https://remote.example.test/",
        supportsUploads: true,
        attachments: [attachment],
        ...dependencies,
      }),
    ).rejects.toMatchObject({ _tag: "ConnectionBlockedError", message });
    expect(dependencies.createUploadUrl).not.toHaveBeenCalled();
  });

  it("keeps underlying upload errors out of caller-visible messages", async () => {
    const dependencies = uploadDependencies();
    dependencies.createUploadUrl.mockRejectedValueOnce(new Error("private remote error details"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      prepareMobileTurnAttachments({
        environmentId,
        httpBaseUrl: "https://remote.example.test/",
        supportsUploads: true,
        attachments: [image("private.png")],
        ...dependencies,
      }),
    ).rejects.toMatchObject({
      _tag: "ConnectionTransientError",
      message: "Could not upload 'private.png'.",
    });
    expect(warning).toHaveBeenCalledWith(
      "Image attachment upload failed.",
      expect.objectContaining({
        attachmentName: "private.png",
        cause: expect.objectContaining({ message: "private remote error details" }),
      }),
    );
    warning.mockRestore();
  });

  it("does not retry an upload rejected by a permanent HTTP error", async () => {
    const dependencies = uploadDependencies();
    mocks.upload.mockResolvedValueOnce({ status: 400 });

    await expect(
      prepareMobileTurnAttachments({
        environmentId,
        httpBaseUrl: "https://remote.example.test/",
        supportsUploads: true,
        attachments: [image("rejected.png")],
        ...dependencies,
      }),
    ).rejects.toMatchObject({
      _tag: "ConnectionBlockedError",
      message: "Could not upload 'rejected.png': upload rejected (400).",
    });
    expect(dependencies.deleteUpload).toHaveBeenCalledWith("pending-1");
  });

  it("reuses uploaded attachment IDs when the same turn is retried", async () => {
    const dependencies = uploadDependencies();
    const input = {
      environmentId,
      commandId: "retryable-turn",
      httpBaseUrl: "https://remote.example.test/",
      supportsUploads: true,
      attachments: [image("retry.png")],
      ...dependencies,
    };

    const first = await prepareMobileTurnAttachments(input);
    const retry = await prepareMobileTurnAttachments(input);

    expect(retry.attachments).toEqual(first.attachments);
    expect(dependencies.createUploadUrl).toHaveBeenCalledTimes(1);
    expect(mocks.upload).toHaveBeenCalledTimes(1);

    await retry.release();
    expect(dependencies.deleteUpload).toHaveBeenCalledTimes(1);
  });

  it("replaces cached uploads when a queued turn is edited", async () => {
    const dependencies = uploadDependencies();
    const input = {
      environmentId,
      commandId: "edited-turn",
      httpBaseUrl: "https://remote.example.test/",
      supportsUploads: true,
      attachments: [image("before.png")],
      ...dependencies,
    };

    await prepareMobileTurnAttachments(input);
    const edited = await prepareMobileTurnAttachments({
      ...input,
      attachments: [{ ...image("after.png"), dataUrl: "data:image/png;base64,ZGVm" }],
    });

    expect(edited.attachments).toMatchObject([{ id: "pending-2", name: "after.png" }]);
    expect(dependencies.createUploadUrl).toHaveBeenCalledTimes(2);
    expect(dependencies.deleteUpload).toHaveBeenCalledWith("pending-1");

    await edited.release();
  });

  it("keeps the previous upload until replacement preparation finishes", async () => {
    const dependencies = uploadDependencies();
    const input = {
      environmentId,
      commandId: "replaced-turn",
      httpBaseUrl: "https://remote.example.test/",
      supportsUploads: true,
      attachments: [image("before.png")],
      ...dependencies,
    };
    const previous = await prepareMobileTurnAttachments(input);
    let finishReplacement!: (result: { status: number }) => void;
    let replacementStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      replacementStarted = resolve;
    });
    mocks.upload.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishReplacement = resolve;
          replacementStarted();
        }),
    );

    const replacing = prepareMobileTurnAttachments({
      ...input,
      attachments: [image("after.png")],
    });
    await started;
    expect(dependencies.deleteUpload).not.toHaveBeenCalledWith("pending-1");

    finishReplacement({ status: 204 });
    const replacement = await replacing;
    expect(dependencies.deleteUpload).toHaveBeenCalledWith("pending-1");

    await previous.release();
    await releaseMobileTurnAttachments({ environmentId, commandId: "replaced-turn" });
    expect(dependencies.deleteUpload).toHaveBeenCalledWith("pending-2");
    await replacement.release();
  });

  it("releases cached uploads when a queued turn is deleted", async () => {
    const dependencies = uploadDependencies();
    await prepareMobileTurnAttachments({
      environmentId,
      commandId: "deleted-turn",
      httpBaseUrl: "https://remote.example.test/",
      supportsUploads: true,
      attachments: [image("deleted.png")],
      ...dependencies,
    });

    await releaseMobileTurnAttachments({ environmentId, commandId: "deleted-turn" });

    expect(dependencies.deleteUpload).toHaveBeenCalledWith("pending-1");
  });

  it("removes an upload URL that resolves after its queued turn was deleted", async () => {
    const dependencies = uploadDependencies();
    let resolveUploadUrl!: (result: AttachmentCreateUploadUrlResult) => void;
    let signalMintStarted!: () => void;
    const mintStarted = new Promise<void>((resolve) => {
      signalMintStarted = resolve;
    });
    dependencies.createUploadUrl.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUploadUrl = resolve;
          signalMintStarted();
        }),
    );
    const preparing = prepareMobileTurnAttachments({
      environmentId,
      commandId: "deleted-during-upload",
      httpBaseUrl: "https://remote.example.test/",
      supportsUploads: true,
      attachments: [image("deleted.png")],
      ...dependencies,
    });
    await mintStarted;

    await releaseMobileTurnAttachments({ environmentId, commandId: "deleted-during-upload" });
    resolveUploadUrl({
      attachmentId: "pending-late",
      relativeUrl: "/api/attachments/upload/pending-late",
      expiresAt: Date.now() + 60_000,
    });

    await expect(preparing).rejects.toMatchObject({ _tag: "ConnectionTransientError" });
    expect(dependencies.deleteUpload).toHaveBeenCalledWith("pending-late");
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("rejects an upload that finishes after its queued turn was deleted", async () => {
    const dependencies = uploadDependencies();
    let finishUpload!: (result: { status: number }) => void;
    let signalUploadStarted!: () => void;
    const uploadStarted = new Promise<void>((resolve) => {
      signalUploadStarted = resolve;
    });
    mocks.upload.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishUpload = resolve;
          signalUploadStarted();
        }),
    );
    const preparing = prepareMobileTurnAttachments({
      environmentId,
      commandId: "deleted-while-finishing",
      httpBaseUrl: "https://remote.example.test/",
      supportsUploads: true,
      attachments: [image("deleted.png")],
      ...dependencies,
    });
    await uploadStarted;

    await releaseMobileTurnAttachments({ environmentId, commandId: "deleted-while-finishing" });
    finishUpload({ status: 204 });

    await expect(preparing).rejects.toMatchObject({ _tag: "ConnectionTransientError" });
    expect(dependencies.deleteUpload).toHaveBeenCalledTimes(2);
    expect(dependencies.deleteUpload).toHaveBeenLastCalledWith("pending-1");
  });

  it("releases every cached upload when an environment is removed", async () => {
    const dependencies = uploadDependencies();
    for (const commandId of ["removed-first", "removed-second"]) {
      await prepareMobileTurnAttachments({
        environmentId,
        commandId,
        httpBaseUrl: "https://remote.example.test/",
        supportsUploads: true,
        attachments: [image(`${commandId}.png`)],
        ...dependencies,
      });
    }

    await releaseMobileTurnAttachments({ environmentId });

    expect(dependencies.deleteUpload).toHaveBeenCalledWith("pending-1");
    expect(dependencies.deleteUpload).toHaveBeenCalledWith("pending-2");
  });

  it("keeps environment and command IDs with colons isolated", async () => {
    const firstEnvironmentId = EnvironmentId.make("a");
    const secondEnvironmentId = EnvironmentId.make("a:b");
    const first = uploadDependencies();
    const second = uploadDependencies();

    await prepareMobileTurnAttachments({
      environmentId: firstEnvironmentId,
      commandId: "b:c",
      httpBaseUrl: "https://first.example.test/",
      supportsUploads: true,
      attachments: [image("first.png")],
      ...first,
    });
    await prepareMobileTurnAttachments({
      environmentId: secondEnvironmentId,
      commandId: "c",
      httpBaseUrl: "https://second.example.test/",
      supportsUploads: true,
      attachments: [image("second.png")],
      ...second,
    });

    await releaseMobileTurnAttachments({ environmentId: firstEnvironmentId });
    expect(first.deleteUpload).toHaveBeenCalledWith("pending-1");
    expect(second.deleteUpload).not.toHaveBeenCalled();

    await releaseMobileTurnAttachments({ environmentId: secondEnvironmentId });
    expect(second.deleteUpload).toHaveBeenCalledWith("pending-1");
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
