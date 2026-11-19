import {
  HandlerContext,
  MediaToolResponse,
  asNumber,
  ValidationError,
} from "./types.js";
import * as formatters from "../formatters/index.js";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";
import type { RedmineIssueUpload } from "../lib/types/index.js";

/**
 * Maximum image size returned to the client.
 * Base64 encoding adds ~33%, so 3.5MB stays under Claude's 5MB per-image limit.
 */
export const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;

const SUPPORTED_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/gif",
  "image/webp",
];

const SUPPORTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

/**
 * Whether the attachment metadata looks like a supported image
 * (checked before downloading, to avoid fetching unsupported files)
 */
function looksLikeSupportedImage(contentType: string | null | undefined, filename: string): boolean {
  if (contentType && SUPPORTED_CONTENT_TYPES.includes(contentType.toLowerCase())) {
    return true;
  }
  const lower = filename.toLowerCase();
  return SUPPORTED_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * Detect image MIME type from the file signature (magic bytes)
 * @returns MIME type, or null if not a supported image format
 */
export function detectImageMimeType(data: Buffer): string | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (data.length >= 6) {
    const header = data.subarray(0, 6).toString("ascii");
    if (header === "GIF87a" || header === "GIF89a") {
      return "image/gif";
    }
  }
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function errorResponse(message: string): MediaToolResponse {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function unsupportedMessage(filename: string, contentType: string | null | undefined): string {
  return `Unsupported attachment type: ${filename}${contentType ? ` (${contentType})` : ""}. ` +
    "Only PNG, JPEG, GIF and WebP images are supported.";
}

function tooLargeMessage(filename: string, size: number): string {
  return `Attachment is too large: ${filename} (${size} bytes). ` +
    `Maximum supported size is ${MAX_IMAGE_BYTES} bytes.`;
}

/**
 * Content types for common upload extensions (others are sent as octet-stream)
 */
const UPLOAD_CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".html": "text/html",
  ".htm": "text/html",
  ".xml": "application/xml",
  ".sql": "text/plain",
  ".zip": "application/zip",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

/**
 * Guess the content type from the file extension
 */
export function guessContentType(filename: string): string {
  return UPLOAD_CONTENT_TYPES[extname(filename).toLowerCase()] ?? "application/octet-stream";
}

interface UploadFile {
  path: string;
  filename: string;
  data: Buffer;
}

/**
 * Validate file_paths and read each file.
 * All files are checked before anything is uploaded.
 */
async function readUploadFiles(paths: unknown): Promise<UploadFile[]> {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new ValidationError("file_paths must be a non-empty array of absolute file paths");
  }

  const files: UploadFile[] = [];
  for (const p of paths) {
    if (typeof p !== "string" || p.trim() === "") {
      throw new ValidationError("file_paths must contain only non-empty strings");
    }
    if (!isAbsolute(p)) {
      throw new ValidationError(`File path must be absolute: ${p}`);
    }

    let info;
    try {
      info = await stat(p);
    } catch {
      throw new ValidationError(`File not found: ${p}`);
    }
    if (!info.isFile()) {
      throw new ValidationError(`Not a file: ${p}`);
    }
    if (info.size === 0) {
      throw new ValidationError(`File is empty: ${p}`);
    }

    files.push({ path: p, filename: basename(p), data: await readFile(p) });
  }
  return files;
}

function optionalString(argsObj: Record<string, unknown>, key: string): string | undefined {
  const value = argsObj[key];
  return value === undefined || value === null ? undefined : String(value);
}

/**
 * Creates handlers for attachment-related operations
 * @param context Handler context containing the Redmine client and config
 * @returns Object containing all attachment-related handlers
 */
export function createAttachmentsHandlers(context: HandlerContext) {
  const { client } = context;

  return {
    /**
     * Gets an image attachment and returns it as MCP image content
     */
    get_attachment: async (args: unknown): Promise<MediaToolResponse> => {
      try {
        // Validate input structure
        if (typeof args !== 'object' || args === null) {
          throw new ValidationError("Arguments must be an object");
        }

        const argsObj = args as Record<string, unknown>;

        // Validate required fields
        if (!('id' in argsObj)) {
          throw new ValidationError("id is required");
        }

        const id = asNumber(argsObj.id);

        const { attachment } = await client.attachments.getAttachment(id);

        // Check type and size before downloading
        if (!looksLikeSupportedImage(attachment.content_type, attachment.filename)) {
          return errorResponse(unsupportedMessage(attachment.filename, attachment.content_type));
        }
        if (attachment.filesize > MAX_IMAGE_BYTES) {
          return errorResponse(tooLargeMessage(attachment.filename, attachment.filesize));
        }

        const { data } = await client.attachments.downloadAttachment(id);

        // Check actual content (metadata may be inaccurate)
        if (data.length > MAX_IMAGE_BYTES) {
          return errorResponse(tooLargeMessage(attachment.filename, data.length));
        }
        const mimeType = detectImageMimeType(data);
        if (!mimeType) {
          return errorResponse(unsupportedMessage(attachment.filename, attachment.content_type));
        }

        return {
          content: [
            {
              type: "text",
              text: formatters.formatAttachment(attachment),
            },
            {
              type: "image",
              data: data.toString("base64"),
              mimeType,
            },
          ],
          isError: false,
        };
      } catch (error) {
        return errorResponse(error instanceof Error ? error.message : String(error));
      }
    },

    /**
     * Uploads local files and attaches them to an issue
     * (all files are uploaded first, then attached with a single issue update)
     */
    add_attachment: async (args: unknown): Promise<MediaToolResponse> => {
      try {
        // Validate input structure
        if (typeof args !== 'object' || args === null) {
          throw new ValidationError("Arguments must be an object");
        }

        const argsObj = args as Record<string, unknown>;

        // Validate required fields
        if (!('issue_id' in argsObj)) {
          throw new ValidationError("issue_id is required");
        }
        if (!('file_paths' in argsObj)) {
          throw new ValidationError("file_paths is required");
        }

        const issueId = asNumber(argsObj.issue_id);
        const description = optionalString(argsObj, "description");
        const notes = optionalString(argsObj, "notes");

        // Check every file before uploading anything
        const files = await readUploadFiles(argsObj.file_paths);

        // Upload each file and collect tokens
        const uploads: RedmineIssueUpload[] = [];
        const lines: string[] = [];
        for (const file of files) {
          const result = await client.attachments.uploadFile(file.data, file.filename);
          const contentType = guessContentType(file.filename);
          uploads.push({
            token: result.token,
            filename: file.filename,
            content_type: contentType,
            ...(description !== undefined && { description }),
          });
          lines.push(
            `- ${file.filename} (${file.data.length} bytes, ${contentType})` +
            (result.id !== undefined ? ` attachment #${result.id}` : "")
          );
        }

        // Attach all uploads with a single issue update (one journal entry)
        await client.issues.updateIssue(issueId, {
          uploads,
          ...(notes !== undefined && { notes }),
          ...('private_notes' in argsObj && { private_notes: Boolean(argsObj.private_notes) }),
        });

        return {
          content: [
            {
              type: "text",
              text: [`Attached ${files.length} file(s) to issue #${issueId}`, ...lines].join("\n"),
            },
          ],
          isError: false,
        };
      } catch (error) {
        return errorResponse(error instanceof Error ? error.message : String(error));
      }
    },
  };
}
