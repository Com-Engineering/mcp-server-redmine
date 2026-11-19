import { jest, expect, describe, it, beforeEach } from '@jest/globals';
import type { Mock } from 'jest-mock';
import { IssuesClient } from '../../../client/issues.js';
import { mockErrorResponse } from '../../helpers/mocks.js';
import config from '../../../config.js';
import { RedmineApiError } from '../../../client/base.js';

describe("Journals API (PUT)", () => {
  let client: IssuesClient;
  let mockFetch: Mock;

  beforeEach(() => {
    client = new IssuesClient();
    mockFetch = jest.spyOn(global, "fetch") as Mock;
    mockFetch.mockReset();
  });

  describe("PUT /journals/:id.json (updateJournal)", () => {
    it("sends the new notes wrapped in a journal object", async () => {
      // Arrange
      mockFetch.mockImplementationOnce(async () => new Response(null, { status: 204 }));

      // Act
      await client.updateJournal(123, { notes: "edited", private_notes: true });

      // Assert
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(new URL("/journals/123.json", config.redmine.host).toString());
      expect(options).toMatchObject({
        method: "PUT",
        headers: expect.objectContaining({
          "X-Redmine-API-Key": config.redmine.apiKey,
          "Content-Type": "application/json",
        }),
      });
      expect(JSON.parse(options.body as string)).toEqual({
        journal: { notes: "edited", private_notes: true },
      });
    });

    it("throws RedmineApiError when the user cannot edit the journal", async () => {
      // Arrange
      mockFetch.mockImplementationOnce(async () => mockErrorResponse(403, ["Forbidden"]));

      // Act & Assert
      await expect(client.updateJournal(123, { notes: "edited" })).rejects.toThrow(RedmineApiError);
    });
  });
});
