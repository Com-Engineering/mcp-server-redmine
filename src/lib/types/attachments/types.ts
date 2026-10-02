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
