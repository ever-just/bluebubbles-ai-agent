import { BaseMessageHandler, ProcessedMessage } from './MessageHandler';
import { BlueBubblesMessage } from '../types';
import { logDebug } from '../utils/logger';

/**
 * Handler for plain text messages.
 */
export class TextMessageHandler extends BaseMessageHandler {
  canHandle(message: BlueBubblesMessage): boolean {
    return !!message.text && (!message.attachments || message.attachments.length === 0);
  }

  async process(message: BlueBubblesMessage): Promise<ProcessedMessage | null> {
    logDebug('Processing text message', { guid: message.guid });

    const processed = this.createBaseProcessedMessage(message);
    processed.text = message.text;
    processed.metadata.originalType = 'text';

    return processed;
  }

  getPriority(): number {
    // Lowest priority so specialised handlers win first.
    return 1;
  }
}
