import { EventEmitter } from 'events';
import { logInfo, logDebug, logWarn } from '../utils/logger';
import { config } from '../config';

interface TypingSession {
  chatGuid: string;
  startedAt: number;
  owner: string;
  autoStopTimer?: NodeJS.Timeout;
}

/**
 * Centralized typing indicator manager.
 * 
 * Provides event-driven typing control that reflects when Claude is actually "thinking",
 * not when we're doing database lookups or message routing.
 * 
 * Features:
 * - Idempotent start (won't restart if already typing)
 * - Owner tracking (prevents accidental stops from wrong code paths)
 * - Auto-stop timer (prevents stuck indicators)
 * - Singleton pattern (single source of truth)
 */
export class TypingManager extends EventEmitter {
  private sessions = new Map<string, TypingSession>();
  private blueBubblesClient: any = null; // Lazy-loaded to avoid circular deps
  private readonly maxTypingDurationMs: number;
  private readonly enabled: boolean;

  constructor() {
    super();
    this.maxTypingDurationMs = config.messaging.typingIndicatorDurationMs || 30000;
    this.enabled = config.messaging.typingIndicators;
  }

  /**
   * Set the BlueBubbles client (called during initialization to avoid circular deps)
   */
  setBlueBubblesClient(client: any): void {
    this.blueBubblesClient = client;
    logDebug('TypingManager: BlueBubbles client set');
  }

  /**
   * Start typing indicator for a chat.
   * Idempotent - won't restart if already typing for this chat.
   * 
   * @param chatGuid - The chat to show typing in
   * @param owner - Identifier for who started typing (e.g., 'claude-request', 'interaction-agent')
   */
  async startTyping(chatGuid: string, owner: string): Promise<void> {
    logInfo('TypingManager: startTyping called', { chatGuid, owner, enabled: this.enabled, hasClient: !!this.blueBubblesClient });
    
    if (!this.enabled) {
      logInfo('TypingManager: Typing indicators disabled - skipping start');
      return;
    }

    if (!chatGuid) {
      logInfo('TypingManager: No chatGuid provided - skipping start');
      return;
    }

    if (!this.blueBubblesClient) {
      logWarn('TypingManager: BlueBubbles client not set - skipping start');
      return;
    }

    // Check if already typing for this chat
    const existingSession = this.sessions.get(chatGuid);
    if (existingSession) {
      logDebug('TypingManager: Already typing, skipping start', { 
        chatGuid, 
        existingOwner: existingSession.owner,
        newOwner: owner 
      });
      return;
    }

    try {
      await this.blueBubblesClient.startTypingIndicator(chatGuid);
      
      const session: TypingSession = {
        chatGuid,
        startedAt: Date.now(),
        owner
      };

      // Set auto-stop timer to prevent stuck indicators
      session.autoStopTimer = setTimeout(() => {
        logWarn('TypingManager: Auto-stopping typing (max duration reached)', { 
          chatGuid, 
          owner,
          durationMs: this.maxTypingDurationMs 
        });
        this.stopTyping(chatGuid, owner, true);
      }, this.maxTypingDurationMs);

      this.sessions.set(chatGuid, session);
      this.emit('typing:started', { chatGuid, owner });

      logInfo('TypingManager: Started typing', { chatGuid, owner });
    } catch (error) {
      logWarn('TypingManager: Failed to start typing', {
        chatGuid,
        owner,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Stop typing indicator for a chat.
   * 
   * @param chatGuid - The chat to stop typing in
   * @param owner - Identifier for who is stopping (must match starter unless force=true)
   * @param force - If true, stop regardless of owner
   */
  async stopTyping(chatGuid: string, owner?: string, force: boolean = false): Promise<void> {
    if (!this.enabled) {
      return;
    }

    if (!chatGuid) {
      logDebug('TypingManager: No chatGuid provided for stop');
      return;
    }

    const session = this.sessions.get(chatGuid);
    if (!session) {
      logDebug('TypingManager: No active typing session to stop', { chatGuid });
      // Still try to send DELETE in case of state mismatch
      if (this.blueBubblesClient) {
        try {
          await this.blueBubblesClient.stopTypingIndicator(chatGuid);
        } catch {
          // Ignore errors when stopping non-existent session
        }
      }
      return;
    }

    // Check owner unless force=true
    if (!force && owner && session.owner !== owner) {
      logDebug('TypingManager: Owner mismatch, not stopping', {
        chatGuid,
        sessionOwner: session.owner,
        requestedOwner: owner
      });
      return;
    }

    // Clear auto-stop timer
    if (session.autoStopTimer) {
      clearTimeout(session.autoStopTimer);
    }

    // Remove session
    this.sessions.delete(chatGuid);

    // Send stop to BlueBubbles
    if (this.blueBubblesClient) {
      try {
        await this.blueBubblesClient.stopTypingIndicator(chatGuid);
        logInfo('TypingManager: Stopped typing', { 
          chatGuid, 
          owner: session.owner,
          durationMs: Date.now() - session.startedAt 
        });
      } catch (error) {
        logWarn('TypingManager: Failed to stop typing', {
          chatGuid,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    this.emit('typing:stopped', { chatGuid, owner: session.owner });
  }

  /**
   * Check if currently typing in a chat.
   */
  isTyping(chatGuid: string): boolean {
    return this.sessions.has(chatGuid);
  }

  /**
   * Get the owner of the current typing session for a chat.
   */
  getTypingOwner(chatGuid: string): string | null {
    const session = this.sessions.get(chatGuid);
    return session?.owner ?? null;
  }

  /**
   * Force stop all typing sessions (useful for cleanup/shutdown).
   */
  async stopAll(): Promise<void> {
    const chatGuids = Array.from(this.sessions.keys());
    for (const chatGuid of chatGuids) {
      await this.stopTyping(chatGuid, undefined, true);
    }
    logInfo('TypingManager: Stopped all typing sessions', { count: chatGuids.length });
  }
}

// Singleton instance
let typingManagerInstance: TypingManager | null = null;

export function getTypingManager(): TypingManager {
  if (!typingManagerInstance) {
    typingManagerInstance = new TypingManager();
  }
  return typingManagerInstance;
}
