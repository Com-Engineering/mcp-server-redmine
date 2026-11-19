import { jest, expect, describe, it, beforeEach } from '@jest/globals';
import type { Mock } from 'jest-mock';
import { RedmineClient } from "../../../lib/client/index.js";
import { mockResponse, mockErrorResponse } from "../../../lib/__tests__/helpers/mocks.js";
import * as fixtures from "../../../lib/__tests__/helpers/fixtures.js";
import config from "../../../lib/config.js";
import { createIssuesHandlers } from "../../issues.js";

const logger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

const noContent = () => Promise.resolve(new Response(null, { status: 204 }));

describe("Issues Handler (delete_issue / watchers) - MCP Response", () => {
  let mockFetch: Mock;
  let handlers: ReturnType<typeof createIssuesHandlers>;

  beforeEach(() => {
    mockFetch = jest.spyOn(global, "fetch") as Mock;
    mockFetch.mockReset();
    handlers = createIssuesHandlers({
      client: new RedmineClient(),
      config,
      logger,
    });
  });

  describe("delete_issue", () => {
    it("deletes the issue", async () => {
      // Arrange
      mockFetch.mockImplementationOnce(noContent);

      // Act
      const response = await handlers.delete_issue({ id: 42 });

      // Assert
      expect(response).toEqual({
        content: [{ type: "text", text: "Issue #42 deleted successfully" }],
        isError: false,
      });
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(new URL("/issues/42.json", config.redmine.host).toString());
      expect(options.method).toBe("DELETE");
    });

    it("rejects a missing id without calling the API", async () => {
      const response = await handlers.delete_issue({});
      expect(response.isError).toBe(true);
      expect(response.content[0]).toEqual({ type: "text", text: expect.stringContaining("id is required") });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns an error response when the issue does not exist", async () => {
      mockFetch.mockImplementationOnce(async () => mockErrorResponse(404, ["Not found"]));
      const response = await handlers.delete_issue({ id: 999 });
      expect(response.isError).toBe(true);
      expect(response.content[0]).toEqual({ type: "text", text: expect.stringContaining("404") });
    });
  });

  describe("add_issue_watcher", () => {
    const issueWithWatchers = (watchers: Array<{ id: number; name: string }>) =>
      mockResponse({ issue: { ...fixtures.singleIssueResponse.issue, watchers } });

    it("adds the user as watcher", async () => {
      // Arrange
      mockFetch
        .mockImplementationOnce(noContent)
        .mockImplementationOnce(async () => issueWithWatchers([{ id: 7, name: "Watcher" }]));

      // Act
      const response = await handlers.add_issue_watcher({ issue_id: 42, user_id: 7 });

      // Assert
      expect(response).toEqual({
        content: [{ type: "text", text: "User #7 added as watcher to issue #42" }],
        isError: false,
      });
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(new URL("/issues/42/watchers.json", config.redmine.host).toString());
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body as string)).toEqual({ user_id: 7 });
      const [checkUrl] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(checkUrl).toBe(new URL("/issues/42.json?include=watchers", config.redmine.host).toString());
    });

    it("returns an error when Redmine silently ignores the user", async () => {
      // Arrange: Redmine answers 204 but the user is not in the watcher list
      mockFetch
        .mockImplementationOnce(noContent)
        .mockImplementationOnce(async () => issueWithWatchers([]));

      // Act
      const response = await handlers.add_issue_watcher({ issue_id: 42, user_id: 9999 });

      // Assert
      expect(response.isError).toBe(true);
      expect(response.content[0]).toEqual({
        type: "text",
        text: expect.stringContaining("User #9999 was not added as watcher"),
      });
    });

    it.each([
      ["missing issue_id", { user_id: 7 }, "issue_id is required"],
      ["missing user_id", { issue_id: 42 }, "user_id is required"],
    ])("rejects %s without calling the API", async (_label, args, message) => {
      const response = await handlers.add_issue_watcher(args);
      expect(response.isError).toBe(true);
      expect(response.content[0]).toEqual({ type: "text", text: expect.stringContaining(message) });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns an error response when Redmine refuses", async () => {
      mockFetch.mockImplementationOnce(async () => mockErrorResponse(422, ["User is invalid"]));
      const response = await handlers.add_issue_watcher({ issue_id: 42, user_id: 9999 });
      expect(response.isError).toBe(true);
      expect(response.content[0]).toEqual({ type: "text", text: expect.stringContaining("User is invalid") });
    });
  });

  describe("remove_issue_watcher", () => {
    it("removes the user from watchers", async () => {
      // Arrange
      mockFetch.mockImplementationOnce(noContent);

      // Act
      const response = await handlers.remove_issue_watcher({ issue_id: 42, user_id: 7 });

      // Assert
      expect(response).toEqual({
        content: [{ type: "text", text: "User #7 removed from watchers of issue #42" }],
        isError: false,
      });
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(new URL("/issues/42/watchers/7.json", config.redmine.host).toString());
      expect(options.method).toBe("DELETE");
    });

    it.each([
      ["missing issue_id", { user_id: 7 }, "issue_id is required"],
      ["missing user_id", { issue_id: 42 }, "user_id is required"],
    ])("rejects %s without calling the API", async (_label, args, message) => {
      const response = await handlers.remove_issue_watcher(args);
      expect(response.isError).toBe(true);
      expect(response.content[0]).toEqual({ type: "text", text: expect.stringContaining(message) });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("get_issue with include=watchers", () => {
    it("lists watchers in the output", async () => {
      // Arrange
      mockFetch.mockImplementationOnce(async () =>
        mockResponse({
          issue: {
            ...fixtures.singleIssueResponse.issue,
            watchers: [{ id: 7, name: "Watcher & Co" }],
          },
        })
      );

      // Act
      const response = await handlers.get_issue({ id: 42, include: "watchers" });

      // Assert
      expect(response.isError).toBe(false);
      const text = (response.content[0] as { text: string }).text;
      expect(text).toContain("<watchers>");
      expect(text).toContain("<id>7</id>");
      expect(text).toContain("<name>Watcher &amp; Co</name>");
    });
  });
});
