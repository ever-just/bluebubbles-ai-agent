import axios from 'axios';
import { BaseMessageHandler, ProcessedMessage } from './MessageHandler';
import { BlueBubblesMessage, BlueBubblesAttachment } from '../types';
import { logDebug, logWarn } from '../utils/logger';
import { config } from '../config';

interface ImageData {
  type: 'base64' | 'url';
  data: string;
  mediaType: string;
}

/**
 * Handler for messages containing image attachments.
 */
export class ImageMessageHandler extends BaseMessageHandler {
  private readonly imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];

  canHandle(message: BlueBubblesMessage): boolean {
    if (!message.attachments || message.attachments.length === 0) {
      return false;
    }

    return message.attachments.some(att => this.isImageAttachment(att.mime_type || att.transfer_name || ''));
  }

  async process(message: BlueBubblesMessage): Promise<ProcessedMessage | null> {
    logDebug('Processing image message', {
      guid: message.guid,
      attachmentCount: message.attachments?.length
    });

    const processed = this.createBaseProcessedMessage(message);
    processed.text = message.text || 'Image attached';
    processed.images = [];
    processed.metadata.originalType = 'image';

    for (const attachment of message.attachments || []) {
      if (this.isImageAttachment(attachment.mime_type || attachment.transfer_name || '')) {
        try {
          const imageData = await this.fetchAttachment(attachment);
          if (imageData) {
            processed.images.push(imageData);
          }
        } catch (error: any) {
          logWarn('Failed to fetch image attachment', {
            guid: attachment.guid,
            error: error.message
          });
        }
      }
    }

    return processed;
  }

  getPriority(): number {
    return 10; // Higher priority for images to process before plain text
  }

  private isImageAttachment(identifier: string): boolean {
    const lower = identifier.toLowerCase();
    return this.imageExtensions.some(ext => lower.includes(ext)) || lower.includes('image/');
  }

  private async fetchAttachment(attachment: BlueBubblesAttachment): Promise<ImageData | null> {
    try {
      const attachmentUrl = `${config.bluebubbles.url}/api/v1/attachment/${attachment.guid}?password=${encodeURIComponent(config.bluebubbles.password)}`;
      logDebug('Fetching attachment', { url: attachmentUrl });

      const response = await axios.get<ArrayBuffer>(attachmentUrl, {
        responseType: 'arraybuffer',
        timeout: 30000
      });

      const base64Data = Buffer.from(response.data).toString('base64');
      const mediaType = attachment.mime_type || 'image/jpeg';

      return {
        type: 'base64',
        data: base64Data,
        mediaType
      };
    } catch (error: any) {
      logWarn('Failed to fetch attachment', {
        guid: attachment.guid,
        error: error.message
      });
      return null;
    }
  }
}
