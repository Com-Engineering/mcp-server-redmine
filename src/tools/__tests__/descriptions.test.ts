import { expect, describe, it } from '@jest/globals';
import {
  ATTACHMENT_ADD_TOOL,
  ISSUE_DELETE_TOOL,
  ISSUE_UPDATE_TOOL,
  JOURNAL_UPDATE_TOOL,
} from "../index.js";

/**
 * Tool descriptions are the only guidance an LLM client gets about how to
 * use a tool safely. Keep the key cautions from being dropped by accident.
 */
describe("Tool description guidance", () => {
  it("delete_issue requires an explicit user request", () => {
    expect(ISSUE_DELETE_TOOL.description).toContain("cannot be undone");
    expect(ISSUE_DELETE_TOOL.description).toContain("explicitly asked");
  });

  it("update_journal explains how to edit only part of a comment", () => {
    expect(JOURNAL_UPDATE_TOOL.description).toContain("Replaces the whole note text");
    expect(JOURNAL_UPDATE_TOOL.description).toContain("include=journals");
  });

  it("update_issue explains that description is replaced as a whole", () => {
    const description = (ISSUE_UPDATE_TOOL.inputSchema.properties as Record<string, { description: string }>)
      .description.description;
    expect(description).toContain("Replaces the whole description");
    expect(description).toContain("get_issue");
  });

  it("add_attachment asks for absolute paths of saved files", () => {
    expect(ATTACHMENT_ADD_TOOL.description).toContain("absolute paths");
    expect(ATTACHMENT_ADD_TOOL.description).toContain("full path of the saved file");
  });
});
