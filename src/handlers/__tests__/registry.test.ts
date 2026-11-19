import { jest, expect, describe, it } from '@jest/globals';
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { RedmineClient } from "../../lib/client/index.js";
import config from "../../lib/config.js";
import * as tools from "../../tools/index.js";
import { createIssuesHandlers } from "../issues.js";
import { createProjectsHandlers } from "../projects.js";
import { createTimeEntriesHandlers } from "../time_entries.js";
import { createUserHandlers } from "../users.js";
import { createAttachmentsHandlers } from "../attachments.js";
import { formatAllowedStatuses } from "../../formatters/projects.js";

const logger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

describe("Tool registry", () => {
  // Same composition as handlers/index.ts
  const context = { client: new RedmineClient(), config, logger };
  const handlers = {
    ...createIssuesHandlers(context),
    ...createProjectsHandlers(context, formatAllowedStatuses),
    ...createTimeEntriesHandlers(context),
    ...createUserHandlers(context),
    ...createAttachmentsHandlers(context),
  };

  // Same filter as the tools/list handler in handlers/index.ts
  const listedTools = Object.values(tools).filter(
    (t) => typeof t === "object" && t !== null && "name" in t && "inputSchema" in t
  ) as Tool[];

  it("has a handler for every listed tool", () => {
    // A listed tool without a handler fails at call time with "Unknown tool"
    const missing = listedTools.map((t) => t.name).filter((name) => !(name in handlers));
    expect(missing).toEqual([]);
  });

  it("lists every handler as a tool", () => {
    const names = new Set(listedTools.map((t) => t.name));
    const unlisted = Object.keys(handlers).filter((name) => !names.has(name));
    expect(unlisted).toEqual([]);
  });
});
