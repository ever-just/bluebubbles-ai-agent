import { BlueBubblesClient } from '../integrations/BlueBubblesClient';
import { logInfo, logDebug, logError } from '../utils/logger';

/**
 * iMessageAdapter handles BlueBubbles-specific output formatting.
 * Converts interaction agent output into proper iMessage format with:
 * - Multiple bubble support via || delimiter
 * - Typing indicators
 * - Appropriate delays between bubbles
 */
export class iMessageAdapter {
  private blueBubblesClient: BlueBubblesClient;
  private delayBetweenBubblesMs: number;

  constructor(blueBubblesClient: BlueBubblesClient, delayBetweenBubblesMs = 500) {
    this.blueBubblesClient = blueBubblesClient;
    this.delayBetweenBubblesMs = delayBetweenBubblesMs;
  }

  /**
   * Send a message to the user, handling multiple bubbles and typing indicators.
   * @param message - The message to send (may contain || delimiters for multiple bubbles)
   * @param chatGuid - The BlueBubbles chat GUID
   */
  async sendToUser(message: string, chatGuid: string): Promise<void> {
    // Split message into bubbles
    const bubbles = this.parseBubbles(message);
    
    if (bubbles.length === 0) {
      logDebug('iMessageAdapter: No content to send');
      return;
    }

    logInfo('iMessageAdapter sending message', {
      chatGuid,
      bubbleCount: bubbles.length,
      totalLength: message.length
    });

    try {
      // Start typing indicator
      await this.startTyping(chatGuid);

      // Send each bubble with delay
      for (let i = 0; i < bubbles.length; i++) {
        const bubble = bubbles[i];
        
        await this.blueBubblesClient.sendMessage(chatGuid, bubble);
        
        logDebug('iMessageAdapter sent bubble', {
          index: i + 1,
          total: bubbles.length,
          length: bubble.length
        });

        // Add delay between bubbles (but not after the last one)
        if (i < bubbles.length - 1) {
          await this.delay(this.delayBetweenBubblesMs);
        }
      }

      // Stop typing indicator
      await this.stopTyping(chatGuid);

    } catch (error) {
      logError('iMessageAdapter failed to send message', error);
      // Try to stop typing indicator even on error
      try {
        await this.stopTyping(chatGuid);
      } catch {
        // Ignore typing indicator cleanup errors
      }
      throw error;
    }
  }

  /**
   * Parse a message into individual bubbles.
   * Uses || as delimiter, trims whitespace, filters empty bubbles.
   */
  parseBubbles(message: string): string[] {
    return message
      .split('||')
      .map(bubble => bubble.trim())
      .filter(bubble => bubble.length > 0);
  }

  /**
   * Start typing indicator for a chat.
   */
  private async startTyping(chatGuid: string): Promise<void> {
    try {
      await this.blueBubblesClient.startTypingIndicator(chatGuid);
    } catch (error) {
      // Typing indicators are optional - don't fail the message send
      logDebug('iMessageAdapter: Failed to start typing indicator', { error });
    }
  }

  /**
   * Stop typing indicator for a chat.
   */
  private async stopTyping(chatGuid: string): Promise<void> {
    try {
      await this.blueBubblesClient.stopTypingIndicator(chatGuid);
    } catch (error) {
      // Typing indicators are optional - don't fail the message send
      logDebug('iMessageAdapter: Failed to stop typing indicator', { error });
    }
  }

  /**
   * Delay helper for timing between bubbles.
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Format a message for iMessage display.
   * Ensures proper formatting and length limits.
   */
  formatMessage(message: string, maxBubbleLength = 1000): string {
    const bubbles = this.parseBubbles(message);
    
    // Truncate overly long bubbles
    const formattedBubbles = bubbles.map(bubble => {
      if (bubble.length > maxBubbleLength) {
        return bubble.substring(0, maxBubbleLength - 3) + '...';
      }
      return bubble;
    });

    return formattedBubbles.join(' || ');
  }
}

// Singleton instance
let adapterInstance: iMessageAdapter | null = null;

export function getIMessageAdapter(blueBubblesClient?: BlueBubblesClient): iMessageAdapter {
  if (!adapterInstance && blueBubblesClient) {
    adapterInstance = new iMessageAdapter(blueBubblesClient);
  }
  if (!adapterInstance) {
    throw new Error('iMessageAdapter not initialized - must provide BlueBubblesClient on first call');
  }
  return adapterInstance;
}

export function initializeIMessageAdapter(blueBubblesClient: BlueBubblesClient): iMessageAdapter {
  adapterInstance = new iMessageAdapter(blueBubblesClient);
  return adapterInstance;
}
