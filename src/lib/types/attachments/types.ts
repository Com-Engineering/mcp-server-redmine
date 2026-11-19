/**
 * Result of POST /uploads.json
 * (id is returned since Redmine 3.4)
 */
export interface RedmineUploadResult {
  id?: number;
  token: string;
}

/**
 * Upload reference attached to an issue on create/update
 */
export interface RedmineIssueUpload {
  token: string;
  filename: string;
  content_type?: string;
  description?: string;
}

/**
 * Redmine attachment (GET /attachments/:id.json, or issue include=attachments)
 */
export interface RedmineAttachment {
  id: number;
  filename: string;
  filesize: number; // bytes
  content_type?: string | null;
  description?: string | null;
  content_url?: string;
  thumbnail_url?: string;
  author?: {
    id: number;
    name: string;
  };
  created_on?: string; // datetime
}
