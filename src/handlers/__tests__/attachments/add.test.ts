import { jest, expect, describe, it, beforeEach, beforeAll, afterAll } from '@jest/globals';
import type { Mock } from 'jest-mock';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RedmineClient } from "../../../lib/client/index.js";
import { mockResponse, mockErrorResponse } from "../../../lib/__tests__/helpers/mocks.js";
import config from "../../../lib/config.js";
import { createAttachmentsHandlers, guessContentType } from "../../attachments.js";

const logger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

const noContent = () => Promise.resolve(new Response(null, { status: 204 }));

describe("guessContentType", () => {
  it("maps common extensions case-insensitively", () => {
    expect(guessContentType("shot.PNG")).toBe("image/png");
    expect(guessContentType("photo.jpeg")).toBe("image/jpeg");
    expect(guessContentType("report.pdf")).toBe("application/pdf");
    expect(guessContentType("data.xlsx")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  });

  it("falls back to octet-stream", () => {
    expect(guessContentType("archive.7z")).toBe("application/octet-stream");
    expect(guessContentType("noext")).toBe("application/octet-stream");
  });
});

describe("Attachments Handler (add_attachment) - MCP Response", () => {
  let mockFetch: Mock;
  let handlers: ReturnType<typeof createAttachmentsHandlers>;
  let dir: string;
  let pngPath: string;
  let txtPath: string;
  let emptyPath: string;
  let subDir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "mcp-redmine-add-"));
    pngPath = join(dir, "evidence.png");
    txtPath = join(dir, "log.txt");
    emptyPath = join(dir, "empty.png");
    subDir = join(dir, "sub");
    writeFileSync(pngPath, PNG_BYTES);
    writeFileSync(txtPath, "hello");
    writeFileSync(emptyPath, "");
    mkdirSync(subDir);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    mockFetch = jest.spyOn(global, "fetch") as Mock;
    mockFetch.mockReset();
    handlers = createAttachmentsHandlers({
      client: new RedmineClient(),
      config,
      logger,
    });
  });

  it("uploads every file and attaches them with one issue update", async () => {
    // Arrange
    mockFetch
      .mockImplementationOnce(async () => mockResponse({ upload: { id: 11, token: "11.aaa" } }, { status: 201 }))
      .mockImplementationOnce(async () => mockResponse({ upload: { id: 12, token: "12.bbb" } }, { status: 201 }))
      .mockImplementationOnce(noContent);

    // Act
    const response = await handlers.add_attachment({
      issue_id: 100,
      file_paths: [pngPath, txtPath],
      description: "evidence",
      notes: "test result",
    });

    // Assert
    expect(response.isError).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Uploads: raw bytes as octet-stream, filename in query
    const [uploadUrl, uploadOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(uploadUrl).toBe(new URL("/uploads.json?filename=evidence.png", config.redmine.host).toString());
    expect(uploadOptions).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        "Content-Type": "application/octet-stream",
        "X-Redmine-API-Key": config.redmine.apiKey,
      }),
    });
    expect(Buffer.from(uploadOptions.body as Uint8Array)).toEqual(PNG_BYTES);

    // Issue update: all tokens in one request, with notes
    const [issueUrl, issueOptions] = mockFetch.mock.calls[2] as [string, RequestInit];
    expect(issueUrl).toBe(new URL("/issues/100.json", config.redmine.host).toString());
    expect(issueOptions.method).toBe("PUT");
    expect(JSON.parse(issueOptions.body as string)).toEqual({
      issue: {
        uploads: [
          { token: "11.aaa", filename: "evidence.png", content_type: "image/png", description: "evidence" },
          { token: "12.bbb", filename: "log.txt", content_type: "text/plain", description: "evidence" },
        ],
        notes: "test result",
      },
    });

    const text = (response.content[0] as { text: string }).text;
    expect(text).toContain("Attached 2 file(s) to issue #100");
    expect(text).toContain("evidence.png (10 bytes, image/png) attachment #11");
    expect(text).toContain("log.txt (5 bytes, text/plain) attachment #12");
  });

  it("encodes non-ASCII file names in the upload URL", async () => {
    // Arrange
    const jpPath = join(dir, "画面確認.png");
    writeFileSync(jpPath, PNG_BYTES);
    mockFetch
      .mockImplementationOnce(async () => mockResponse({ upload: { id: 13, token: "13.ccc" } }, { status: 201 }))
      .mockImplementationOnce(noContent);

    // Act
    const response = await handlers.add_attachment({ issue_id: 100, file_paths: [jpPath], private_notes: true });

    // Assert
    expect(response.isError).toBe(false);
    const [uploadUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(uploadUrl).toContain(`filename=${encodeURIComponent("画面確認.png")}`);
    const [, issueOptions] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(issueOptions.body as string)).toEqual({
      issue: {
        uploads: [{ token: "13.ccc", filename: "画面確認.png", content_type: "image/png" }],
        private_notes: true,
      },
    });
  });

  it.each([
    ["missing issue_id", () => ({ file_paths: [pngPath] }), "issue_id is required"],
    ["missing file_paths", () => ({ issue_id: 100 }), "file_paths is required"],
    ["empty file_paths", () => ({ issue_id: 100, file_paths: [] }), "non-empty array"],
    ["relative path", () => ({ issue_id: 100, file_paths: ["evidence.png"] }), "must be absolute"],
    ["missing file", () => ({ issue_id: 100, file_paths: [join(dir, "nope.png")] }), "File not found"],
    ["directory", () => ({ issue_id: 100, file_paths: [subDir] }), "Not a file"],
    ["empty file", () => ({ issue_id: 100, file_paths: [emptyPath] }), "File is empty"],
    ["one bad file among good ones", () => ({ issue_id: 100, file_paths: [pngPath, join(dir, "nope.png")] }), "File not found"],
  ])("rejects %s without calling the API", async (_label, makeArgs, message) => {
    // Act
    const response = await handlers.add_attachment(makeArgs());

    // Assert
    expect(response.isError).toBe(true);
    expect(response.content[0]).toEqual({ type: "text", text: expect.stringContaining(message) });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not update the issue when an upload fails", async () => {
    // Arrange: Redmine returns 422 when the file exceeds the size limit
    mockFetch.mockImplementationOnce(async () =>
      mockErrorResponse(422, ["This file cannot be uploaded because it exceeds the maximum allowed file size"])
    );

    // Act
    const response = await handlers.add_attachment({ issue_id: 100, file_paths: [pngPath, txtPath] });

    // Assert
    expect(response.isError).toBe(true);
    expect(response.content[0]).toEqual({ type: "text", text: expect.stringContaining("maximum allowed file size") });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns an error when the issue update fails", async () => {
    // Arrange
    mockFetch
      .mockImplementationOnce(async () => mockResponse({ upload: { id: 11, token: "11.aaa" } }, { status: 201 }))
      .mockImplementationOnce(async () => mockErrorResponse(404, ["Not found"]));

    // Act
    const response = await handlers.add_attachment({ issue_id: 999, file_paths: [pngPath] });

    // Assert
    expect(response.isError).toBe(true);
    expect(response.content[0]).toEqual({ type: "text", text: expect.stringContaining("404") });
  });
});
