import type { RedmineAttachment } from "../lib/types/index.js";

/**
 * Escape XML special characters
 */
function escapeXml(unsafe: string | null | undefined): string {
  if (unsafe === null || unsafe === undefined) {
    return '';
  }
  return unsafe
    .replace(/[&]/g, '&amp;')
    .replace(/[<]/g, '&lt;')
    .replace(/[>]/g, '&gt;')
    .replace(/["]/g, '&quot;')
    .replace(/[']/g, '&apos;');
}

/**
 * Format attachment metadata
 */
export function formatAttachment(attachment: RedmineAttachment): string {
  return `<attachment>
  <id>${attachment.id}</id>
  <filename>${escapeXml(attachment.filename)}</filename>
  <filesize>${attachment.filesize}</filesize>
  ${attachment.content_type ? `<content_type>${escapeXml(attachment.content_type)}</content_type>` : ''}
  ${attachment.description ? `<description>${escapeXml(attachment.description)}</description>` : ''}
  ${attachment.author ? `<author>${escapeXml(attachment.author.name)}</author>` : ''}
  ${attachment.created_on ? `<created_on>${attachment.created_on}</created_on>` : ''}
</attachment>`;
}
