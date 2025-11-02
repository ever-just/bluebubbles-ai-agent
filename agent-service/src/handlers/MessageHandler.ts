import { BlueBubblesMessage } from '../types';

/**
 * Processed message content passed to ClaudeService.
 */
export interface ProcessedMessage {
  text?: string;
  images?: Array<{
    type: 'base64' | 'url';
    data: string;
    mediaType: string;
  }>;
  audio?: {
    transcription: string;
    duration?: number;
  };
  files?: Array<{
    name: string;
    type: string;
    content?: string;
  }>;
  metadata: {
    originalType: string;
    hasAttachments: boolean;
    attachmentCount: number;
    [key: string]: any;
  };
}

/**
 * Interface implemented by all message handlers.
 */
export interface IMessageHandler {
  canHandle(message: BlueBubblesMessage): boolean;
  process(message: BlueBubblesMessage): Promise<ProcessedMessage | null>;
  getPriority(): number;
}

/**
 * Base class that provides shared helper utilities for handlers.
 */
export abstract class BaseMessageHandler implements IMessageHandler {
  abstract canHandle(message: BlueBubblesMessage): boolean;
  abstract process(message: BlueBubblesMessage): Promise<ProcessedMessage | null>;

  getPriority(): number {
    return 0;
  }

  protected createBaseProcessedMessage(message: BlueBubblesMessage): ProcessedMessage {
    return {
      metadata: {
        originalType: 'unknown',
        hasAttachments: (message.attachments?.length || 0) > 0,
        attachmentCount: message.attachments?.length || 0
      }
    };
  }
}
