import { jest, expect, describe, it, beforeEach } from '@jest/globals';
import type { Mock } from 'jest-mock';
import { AttachmentsClient } from '../../../client/attachments.js';
import { IssuesClient } from '../../../client/issues.js';
import { mockResponse, mockErrorResponse } from '../../helpers/mocks.js';
import * as fixtures from '../../helpers/fixtures.js';
import config from '../../../config.js';
import { RedmineApiError } from '../../../client/base.js';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

describe("Attachments API (GET)", () => {
  let client: AttachmentsClient;
  let mockFetch: Mock;

  beforeEach(() => {
    client = new AttachmentsClient();
    mockFetch = jest.spyOn(global, "fetch") as Mock;
    mockFetch.mockReset();
  });

  describe("GET /attachments/:id.json (getAttachment)", () => {
    it("fetches attachment metadata", async () => {
      // Arrange
      mockFetch.mockImplementationOnce(async () =>
        mockResponse(fixtures.singleAttachmentResponse)
      );

      // Act
      const result = await client.getAttachment(5);

      // Assert
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(new URL("/attachments/5.json", config.redmine.host).toString());
      expect(options).toMatchObject({
        method: "GET",
        headers: expect.objectContaining({
          "X-Redmine-API-Key": config.redmine.apiKey,
        }),
      });
      expect(result).toEqual(fixtures.singleAttachmentResponse);
    });

    it("throws RedmineApiError when attachment is not found", async () => {
      // Arrange
      mockFetch.mockImplementationOnce(async () =>
        mockErrorResponse(404, ["Not found"])
      );

      // Act & Assert
      await expect(client.getAttachment(999)).rejects.toThrow(RedmineApiError);
    });
  });

  describe("GET /attachments/download/:id (downloadAttachment)", () => {
    it("downloads binary content from REDMINE_HOST", async () => {
      // Arrange
      mockFetch.mockImplementationOnce(async () =>
        new Response(PNG_BYTES, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        })
      );

      // Act
      const result = await client.downloadAttachment(5);

      // Assert
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(new URL("/attachments/download/5", config.redmine.host).toString());
      expect(options).toMatchObject({
        method: "GET",
        headers: expect.objectContaining({
          "X-Redmine-API-Key": config.redmine.apiKey,
        }),
      });
      expect(result.contentType).toBe("image/png");
      expect(Buffer.compare(result.data, Buffer.from(PNG_BYTES))).toBe(0);
    });

    it("throws RedmineApiError on error response", async () => {
      // Arrange
      mockFetch.mockImplementationOnce(async () =>
        mockErrorResponse(403, ["Forbidden"])
      );

      // Act & Assert
      await expect(client.downloadAttachment(5)).rejects.toThrow(RedmineApiError);
    });

    it("throws RedmineApiError on network error", async () => {
      // Arrange
      mockFetch.mockImplementationOnce(async () => {
        throw new Error("connection refused");
      });

      // Act & Assert
      await expect(client.downloadAttachment(5)).rejects.toThrow(/Network Error/);
    });
  });

  describe("GET /issues/:id.json?include=attachments", () => {
    it("keeps attachments in the parsed issue", async () => {
      // Arrange
      const issuesClient = new IssuesClient();
      mockFetch.mockImplementationOnce(async () =>
        mockResponse(fixtures.singleIssueWithAttachmentsResponse)
      );

      // Act
      const result = await issuesClient.getIssue(1, { include: "attachments" });

      // Assert
      expect(result.issue.attachments).toEqual(
        fixtures.singleIssueWithAttachmentsResponse.issue.attachments
      );
    });
  });
});
