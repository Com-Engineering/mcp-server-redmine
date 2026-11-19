import { jest, expect, describe, it, beforeEach } from '@jest/globals';
import type { Mock } from 'jest-mock';
import { RedmineClient } from "../../../lib/client/index.js";
import { mockErrorResponse } from "../../../lib/__tests__/helpers/mocks.js";
import config from "../../../lib/config.js";
import { createIssuesHandlers } from "../../issues.js";

const logger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

describe("Issues Handler (update_journal) - MCP Response", () => {
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

  it("updates the journal and reports success", async () => {
    // Arrange
    mockFetch.mockImplementationOnce(async () => new Response(null, { status: 204 }));

    // Act
    const response = await handlers.update_journal({ id: 77, notes: "fixed typo" });

    // Assert
    expect(response).toEqual({
      content: [{ type: "text", text: "Journal #77 updated successfully" }],
      isError: false,
    });
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(new URL("/journals/77.json", config.redmine.host).toString());
    expect(JSON.parse(options.body as string)).toEqual({ journal: { notes: "fixed typo" } });
  });

  it("passes private_notes when given", async () => {
    // Arrange
    mockFetch.mockImplementationOnce(async () => new Response(null, { status: 204 }));

    // Act
    await handlers.update_journal({ id: 77, notes: "secret", private_notes: false });

    // Assert
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(options.body as string)).toEqual({
      journal: { notes: "secret", private_notes: false },
    });
  });

  it.each([
    ["missing id", { notes: "x" }, "id is required"],
    ["missing notes", { id: 77 }, "notes is required"],
    ["empty notes", { id: 77, notes: "" }, "must not be empty"],
    ["whitespace-only notes", { id: 77, notes: "  \n " }, "must not be empty"],
  ])("rejects %s without calling the API", async (_label, args, message) => {
    // Act
    const response = await handlers.update_journal(args);

    // Assert
    expect(response.isError).toBe(true);
    expect(response.content[0]).toEqual({ type: "text", text: expect.stringContaining(message) });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns an error response when Redmine refuses the edit", async () => {
    // Arrange
    mockFetch.mockImplementationOnce(async () => mockErrorResponse(403, ["Forbidden"]));

    // Act
    const response = await handlers.update_journal({ id: 77, notes: "x" });

    // Assert
    expect(response.isError).toBe(true);
    expect(response.content[0]).toEqual({ type: "text", text: expect.stringContaining("403") });
  });
});
