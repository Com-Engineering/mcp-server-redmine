import { BaseClient } from "./base.js";
import { RedmineAttachment, RedmineUploadResult } from "../types/index.js";
import { RedmineAttachmentSchema, RedmineUploadResultSchema } from "../types/attachments/schema.js";

export class AttachmentsClient extends BaseClient {
  /**
   * Get attachment metadata
   * Available since Redmine 1.3
   *
   * @param id Attachment ID
   * @returns Promise with attachment metadata
   */
  async getAttachment(id: number): Promise<{ attachment: RedmineAttachment }> {
    const response = await this.performRequest<{ attachment: RedmineAttachment }>(
      `attachments/${id}.json`
    );
    return {
      attachment: RedmineAttachmentSchema.parse(response.attachment),
    };
  }

  /**
   * Download attachment content
   *
   * The URL is always built from REDMINE_HOST instead of using content_url,
   * so the API key is never sent to a host other than the configured one.
   *
   * @param id Attachment ID
   * @returns Promise with raw content and the Content-Type header
   */
  async downloadAttachment(
    id: number
  ): Promise<{ data: Buffer; contentType: string | null }> {
    return await this.performBinaryRequest(`attachments/download/${id}`);
  }

  /**
   * Upload file content and get a token to attach it to an issue
   * Available since Redmine 1.4 (filename parameter and returned id since 3.4)
   *
   * @param data Raw file content
   * @param filename File name sent as a hint to Redmine
   * @returns Promise with the upload token (and attachment id)
   */
  async uploadFile(data: Buffer, filename: string): Promise<RedmineUploadResult> {
    const response = await this.performRequest<{ upload: RedmineUploadResult }>(
      `uploads.json?filename=${encodeURIComponent(filename)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(data),
      }
    );
    return RedmineUploadResultSchema.parse(response.upload);
  }
}
