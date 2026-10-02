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
