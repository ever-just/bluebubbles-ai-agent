import { BlueBubblesMessage } from '../types';
import { logDebug, logWarn } from '../utils/logger';
import { AudioMessageHandler } from './AudioMessageHandler';
import { ImageMessageHandler } from './ImageMessageHandler';
import { ReactionHandler } from './ReactionHandler';
import { TextMessageHandler } from './TextMessageHandler';
import type { IMessageHandler, ProcessedMessage } from './MessageHandler';

/**
 * Factory responsible for coordinating message handlers.
 */
export class MessageHandlerFactory {
  private handlers: IMessageHandler[] = [];

  constructor() {
    // Register handlers by priority (high to low).
    this.registerHandler(new ReactionHandler());
    this.registerHandler(new AudioMessageHandler());
    this.registerHandler(new ImageMessageHandler());
    this.registerHandler(new TextMessageHandler());

    logDebug('Message handler factory initialized', {
      handlerCount: this.handlers.length
    });
  }

  registerHandler(handler: IMessageHandler): void {
    this.handlers.push(handler);
    this.handlers.sort((a, b) => b.getPriority() - a.getPriority());
  }

  async processMessage(message: BlueBubblesMessage): Promise<ProcessedMessage | null> {
    if (!message.text && (!message.attachments || message.attachments.length === 0)) {
      logDebug('Skipping empty message', { guid: message.guid });
      return null;
    }

    for (const handler of this.handlers) {
      if (handler.canHandle(message)) {
        logDebug('Processing message with handler', {
          guid: message.guid,
          handler: handler.constructor.name
        });

        try {
          return await handler.process(message);
        } catch (error: any) {
          logWarn('Handler failed to process message', {
            guid: message.guid,
            handler: handler.constructor.name,
            error: error.message
          });
        }
      }
    }

    logWarn('No handler found for message', {
      guid: message.guid,
      hasText: !!message.text,
      attachmentCount: message.attachments?.length || 0
    });

    return null;
  }

  getHandlers(): IMessageHandler[] {
    return [...this.handlers];
  }
}

let factoryInstance: MessageHandlerFactory | null = null;

export const getMessageHandlerFactory = (): MessageHandlerFactory => {
  if (!factoryInstance) {
    factoryInstance = new MessageHandlerFactory();
  }

  return factoryInstance;
};
