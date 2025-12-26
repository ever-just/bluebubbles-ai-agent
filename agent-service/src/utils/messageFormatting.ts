/**
 * Message Formatting Utilities
 * 
 * Provides formatting functions for messages sent to users via iMessage.
 */

/**
 * Format search results for better iMessage display.
 * - Removes excessive newlines
 * - Ensures consistent bullet points
 * - Truncates if too long
 */
export function formatSearchResults(text: string): string {
  let formatted = text;
  
  // Remove excessive newlines (more than 2 in a row)
  formatted = formatted.replace(/\n{3,}/g, '\n\n');
  
  // Ensure bullet points are consistent (convert various bullet styles to •)
  formatted = formatted.replace(/^[●○◦▪▫]\s*/gm, '• ');
  
  // Remove leading/trailing whitespace from each line
  formatted = formatted.split('\n').map(line => line.trim()).join('\n');
  
  // Remove empty lines at start and end
  formatted = formatted.trim();
  
  // Truncate if too long for iMessage (keep under 1000 chars for readability)
  if (formatted.length > 1000) {
    // Try to cut at a sentence boundary
    const truncated = formatted.substring(0, 997);
    const lastPeriod = truncated.lastIndexOf('.');
    const lastNewline = truncated.lastIndexOf('\n');
    const cutPoint = Math.max(lastPeriod, lastNewline);
    
    if (cutPoint > 800) {
      formatted = formatted.substring(0, cutPoint + 1).trim() + '...';
    } else {
      formatted = truncated.trim() + '...';
    }
  }
  
  return formatted;
}

/**
 * Clean up message text for saving to database.
 * - Removes || bubble separators
 * - Normalizes whitespace
 */
export function cleanMessageForStorage(text: string): string {
  return text
    .replace(/\s*\|\|\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
