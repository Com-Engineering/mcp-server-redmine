import { jest, expect, describe, it, beforeEach } from '@jest/globals';
import type { Mock } from 'jest-mock';
import { RedmineClient } from "../../../lib/client/index.js";
import { mockResponse, mockErrorResponse } from "../../../lib/__tests__/helpers/mocks.js";
import * as fixtures from "../../../lib/__tests__/helpers/fixtures.js";
import config from "../../../lib/config.js";
import { createAttachmentsHandlers, detectImageMimeType, MAX_IMAGE_BYTES } from "../../attachments.js";
import { createIssuesHandlers } from "../../issues.js";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF_BYTES = Buffer.from("GIF89a\x01\x00", "latin1");
const WEBP_BYTES = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8 ", "ascii"),
]);

const binaryResponse = (data: Buffer, contentType = "application/octet-stream") =>
  Promise.resolve(new Response(new Uint8Array(data), {
    status: 200,
    headers: { "Content-Type": contentType },
  }));

const attachmentResponse = (overrides: Record<string, unknown>) => ({
  attachment: { ...fixtures.singleAttachmentResponse.attachment, ...overrides },
});

const logger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

describe("detectImageMimeType", () => {
  it("detects supported image formats", () => {
    expect(detectImageMimeType(PNG_BYTES)).toBe("image/png");
    expect(detectImageMimeType(JPEG_BYTES)).toBe("image/jpeg");
    expect(detectImageMimeType(GIF_BYTES)).toBe("image/gif");
    expect(detectImageMimeType(WEBP_BYTES)).toBe("image/webp");
  });

  it("returns null for unsupported or non-image data", () => {
    expect(detectImageMimeType(Buffer.from("BM\x00\x00\x00\x00", "latin1"))).toBeNull(); // BMP
    expect(detectImageMimeType(Buffer.from("%PDF-1.7", "ascii"))).toBeNull();
    expect(detectImageMimeType(Buffer.from("<html>", "ascii"))).toBeNull();
    expect(detectImageMimeType(Buffer.alloc(0))).toBeNull();
  });
});

describe("Attachments Handler (get_attachment) - MCP Response", () => {
  let mockFetch: Mock;
  let handlers: ReturnType<typeof createAttachmentsHandlers>;

  beforeEach(() => {
    mockFetch = jest.spyOn(global, "fetch") as Mock;
    mockFetch.mockReset();
    handlers = createAttachmentsHandlers({
      client: new RedmineClient(),
      config,
      logger,
    });
  });

  it("returns metadata and image content for a PNG attachment", async () => {
    // Arrange
    mockFetch
      .mockImplementationOnce(async () => mockResponse(fixtures.singleAttachmentResponse))
      .mockImplementationOnce(async () => binaryResponse(PNG_BYTES, "image/png"));

    // Act
    const response = await handlers.get_attachment({ id: 5 });

    // Assert
    expect(response.isError).toBe(false);
    expect(response.content).toHaveLength(2);
    expect(response.content[0]).toEqual({
      type: "text",
      text: expect.stringContaining("<filename>screenshot.png</filename>"),
    });
    expect(response.content[1]).toEqual({
      type: "image",
      data: PNG_BYTES.toString("base64"),
      mimeType: "image/png",
    });
    const [downloadUrl] = mockFetch.mock.calls[1] as [string];
    expect(downloadUrl).toBe(new URL("/attachments/download/5", config.redmine.host).toString());
  });

  it("uses the detected MIME type when content_type is generic but the extension is an image", async () => {
    // Arrange
    mockFetch
      .mockImplementationOnce(async () =>
        mockResponse(attachmentResponse({ filename: "photo.JPG", content_type: "application/octet-stream" }))
      )
      .mockImplementationOnce(async () => binaryResponse(JPEG_BYTES));

    // Act
    const response = await handlers.get_attachment({ id: 5 });

    // Assert
    expect(response.isError).toBe(false);
    expect(response.content[1]).toMatchObject({ type: "image", mimeType: "image/jpeg" });
  });

  it("rejects non-image attachments without downloading", async () => {
    // Arrange
    mockFetch.mockImplementationOnce(async () =>
      mockResponse(attachmentResponse({ filename: "spec.pdf", content_type: "application/pdf" }))
    );

    // Act
    const response = await handlers.get_attachment({ id: 5 });

    // Assert
    expect(response.isError).toBe(true);
    expect(response.content[0]).toEqual({
      type: "text",
      text: expect.stringContaining("Unsupported attachment type: spec.pdf (application/pdf)"),
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported image formats such as BMP without downloading", async () => {
    // Arrange
    mockFetch.mockImplementationOnce(async () =>
      mockResponse(attachmentResponse({ filename: "image.bmp", content_type: "image/bmp" }))
    );

    // Act
    const response = await handlers.get_attachment({ id: 5 });

    // Assert
    expect(response.isError).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects attachments larger than the limit without downloading", async () => {
    // Arrange
    mockFetch.mockImplementationOnce(async () =>
      mockResponse(attachmentResponse({ filesize: MAX_IMAGE_BYTES + 1 }))
    );

    // Act
    const response = await handlers.get_attachment({ id: 5 });

    // Assert
    expect(response.isError).toBe(true);
    expect(response.content[0]).toEqual({
      type: "text",
      text: expect.stringContaining("Attachment is too large"),
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("accepts attachments exactly at the size limit", async () => {
    // Arrange
    const data = Buffer.concat([PNG_BYTES, Buffer.alloc(MAX_IMAGE_BYTES - PNG_BYTES.length)]);
    mockFetch
      .mockImplementationOnce(async () => mockResponse(attachmentResponse({ filesize: MAX_IMAGE_BYTES })))
      .mockImplementationOnce(async () => binaryResponse(data, "image/png"));

    // Act
    const response = await handlers.get_attachment({ id: 5 });

    // Assert
    expect(response.isError).toBe(false);
  });

  it("rejects when the downloaded content exceeds the limit despite metadata", async () => {
    // Arrange
    const data = Buffer.concat([PNG_BYTES, Buffer.alloc(MAX_IMAGE_BYTES)]);
    mockFetch
      .mockImplementationOnce(async () => mockResponse(fixtures.singleAttachmentResponse))
      .mockImplementationOnce(async () => binaryResponse(data, "image/png"));

    // Act
    const response = await handlers.get_attachment({ id: 5 });

    // Assert
    expect(response.isError).toBe(true);
    expect(response.content[0]).toEqual({
      type: "text",
      text: expect.stringContaining("Attachment is too large"),
    });
  });

  it("rejects when the downloaded content is not actually an image", async () => {
    // Arrange
    mockFetch
      .mockImplementationOnce(async () => mockResponse(fixtures.singleAttachmentResponse))
      .mockImplementationOnce(async () => binaryResponse(Buffer.from("<html>login</html>"), "text/html"));

    // Act
    const response = await handlers.get_attachment({ id: 5 });

    // Assert
    expect(response.isError).toBe(true);
    expect(response.content[0]).toEqual({
      type: "text",
      text: expect.stringContaining("Unsupported attachment type"),
    });
  });

  it("returns error response for API error", async () => {
    // Arrange
    mockFetch.mockImplementationOnce(async () => mockErrorResponse(404, ["Not found"]));

    // Act
    const response = await handlers.get_attachment({ id: 999 });

    // Assert
    expect(response.isError).toBe(true);
    expect(response.content[0]).toEqual({
      type: "text",
      text: expect.stringContaining("404"),
    });
  });

  it("returns error response when id is missing or invalid", async () => {
    expect((await handlers.get_attachment({})).isError).toBe(true);
    expect((await handlers.get_attachment({ id: "abc" })).isError).toBe(true);
    expect((await handlers.get_attachment(null)).isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("Issues Handler (get_issue) - attachments", () => {
  it("lists attachments in the issue output", async () => {
    // Arrange
    const mockFetch = jest.spyOn(global, "fetch") as Mock;
    mockFetch.mockImplementationOnce(async () =>
      mockResponse(fixtures.singleIssueWithAttachmentsResponse)
    );
    const handlers = createIssuesHandlers({ client: new RedmineClient(), config, logger });

    // Act
    const response = await handlers.get_issue({ id: 1, include: "attachments" });

    // Assert
    expect(response.isError).toBe(false);
    const text = response.content[0].text;
    expect(text).toContain("<attachments>");
    expect(text).toContain("<id>5</id>");
    expect(text).toContain("<filename>screenshot.png</filename>");
    expect(text).toContain("<content_type>image/png</content_type>");
  });
});
