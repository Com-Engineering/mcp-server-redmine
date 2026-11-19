import { Tool } from "@modelcontextprotocol/sdk/types.js";

// Get attachment tool
export const ATTACHMENT_GET_TOOL: Tool = {
  name: "get_attachment",
  description:
    "Get an image attachment by its ID and return the image so it can be viewed. " +
    "Attachment IDs can be found with get_issue using include=attachments. " +
    "Only PNG, JPEG, GIF and WebP images up to 3.5MB are supported; other files are rejected. " +
    "Available since Redmine 1.3",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "number",
        description: "ID of the attachment to retrieve",
      },
    },
    required: ["id"],
  },
};

// Add attachment tool
export const ATTACHMENT_ADD_TOOL: Tool = {
  name: "add_attachment",
  description:
    "Upload local files and attach them to an existing issue, e.g. screenshots as test evidence. " +
    "Files are read from the machine running this MCP server, so pass absolute paths; relative paths are rejected. " +
    "For files saved by other tools (e.g. a Playwright screenshot), pass the full path of the saved file, " +
    "including the tool's output directory. " +
    "All files are attached in one issue update, optionally with a comment (notes). " +
    "Every file is checked before uploading; if a file is missing or an upload fails, nothing is attached. " +
    "Redmine rejects files larger than its configured maximum attachment size. " +
    "Available since Redmine 1.4",
  inputSchema: {
    type: "object",
    properties: {
      issue_id: {
        type: "number",
        description: "ID of the issue to attach files to",
      },
      file_paths: {
        type: "array",
        description: "Absolute paths of the local files to attach. The file name is used as the attachment name",
        items: {
          type: "string",
        },
        minItems: 1,
      },
      description: {
        type: "string",
        description: "Description set on every attached file",
      },
      notes: {
        type: "string",
        description: "Comment added to the issue together with the attachments",
      },
      private_notes: {
        type: "boolean",
        description: "Set true to make the comment private",
      },
    },
    required: ["issue_id", "file_paths"],
  },
};
