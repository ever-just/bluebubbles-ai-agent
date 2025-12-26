import { AgentMailClient as AgentMailSDK } from 'agentmail';
import { config } from '../config';
import { logInfo, logError, logDebug, logWarn } from '../utils/logger';
import { AppDataSource } from '../database/connection';
import { AgentMailInbox } from '../database/entities/AgentMailInbox';

// Hardcoded Grace inbox - all users share this inbox for now
const GRACE_INBOX_ID = 'grace@agentmail.to';

/**
 * AgentMailClient - Integration with AgentMail.to for agent email capabilities.
 * Currently uses a shared Grace inbox for all users.
 * TODO: Re-enable user-siloed inboxes when needed.
 */
class AgentMailClient {
  private client: AgentMailSDK | null = null;
  private initialized = false;

  private getInboxRepo() {
    return AppDataSource.getRepository(AgentMailInbox);
  }

  initialize(): void {
    if (this.initialized) return;
    
    if (config.agentmail.enabled && config.agentmail.apiKey) {
      this.client = new AgentMailSDK({ apiKey: config.agentmail.apiKey });
      this.initialized = true;
      logInfo('AgentMailClient initialized');
    } else {
      logWarn('AgentMailClient not initialized - missing API key or disabled');
    }
  }

  isEnabled(): boolean {
    // Initialize if not already done, then check
    if (!this.initialized) {
      this.initialize();
    }
    return this.client !== null && config.agentmail.enabled;
  }

  /**
   * Returns the shared Grace inbox for all users.
   * TODO: Re-enable per-user inboxes when needed.
   */
  async getOrCreateInbox(userId: string, _displayName?: string): Promise<{ inboxId: string; emailAddress: string } | null> {
    if (!this.client) {
      this.initialize();
      if (!this.client) {
        logWarn('AgentMailClient not initialized');
        return null;
      }
    }

    // Always use the shared Grace inbox
    logDebug('Using shared Grace inbox', { userId, inboxId: GRACE_INBOX_ID });
    return {
      inboxId: GRACE_INBOX_ID,
      emailAddress: GRACE_INBOX_ID
    };
  }

  /**
   * Returns the shared Grace inbox.
   */
  async getInboxByUserId(userId: string): Promise<{ inboxId: string; emailAddress: string } | null> {
    logDebug('Using shared Grace inbox for user', { userId });
    return {
      inboxId: GRACE_INBOX_ID,
      emailAddress: GRACE_INBOX_ID
    };
  }

  /**
   * Returns the shared Grace inbox if the email matches.
   */
  async getInboxByEmail(emailAddress: string): Promise<{ inboxId: string; emailAddress: string } | null> {
    if (emailAddress === GRACE_INBOX_ID) {
      return {
        inboxId: GRACE_INBOX_ID,
        emailAddress: GRACE_INBOX_ID
      };
    }
    logWarn('Email address does not match Grace inbox', { emailAddress, expected: GRACE_INBOX_ID });
    return null;
  }

  async sendEmail(
    userId: string,
    to: string,
    subject: string,
    body: string,
    options?: { html?: string; cc?: string; bcc?: string }
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.client) {
      this.initialize();
      if (!this.client) {
        return { success: false, error: 'AgentMail not configured' };
      }
    }

    try {
      const inbox = await this.getOrCreateInbox(userId);
      if (!inbox) {
        return { success: false, error: 'Could not get or create inbox' };
      }

      logInfo('Sending email via AgentMail', {
        userId,
        from: inbox.emailAddress,
        to,
        subject: subject.substring(0, 50)
      });

      const message = await this.client.inboxes.messages.send(inbox.inboxId, {
        to,
        subject,
        text: body,
        html: options?.html,
        cc: options?.cc,
        bcc: options?.bcc
      });

      logInfo('Email sent successfully', {
        userId,
        messageId: message.messageId,
        to
      });

      return { success: true, messageId: message.messageId };
    } catch (error: any) {
      logError('Failed to send email', error, { userId, to, subject });
      return { success: false, error: error.message || 'Failed to send email' };
    }
  }

  async listEmails(
    userId: string,
    options?: { limit?: number }
  ): Promise<{ success: boolean; emails?: any[]; error?: string }> {
    if (!this.client) {
      this.initialize();
      if (!this.client) {
        return { success: false, error: 'AgentMail not configured' };
      }
    }

    try {
      const inbox = await this.getInboxByUserId(userId);
      if (!inbox) {
        return { success: false, error: 'No inbox found for user' };
      }

      const messages = await this.client.inboxes.messages.list(inbox.inboxId);

      const limit = options?.limit || 10;
      const emails = (messages.messages || []).slice(0, limit).map((msg: any) => ({
        messageId: msg.messageId,
        threadId: msg.threadId,
        from: msg.from,
        to: msg.to,
        subject: msg.subject,
        snippet: msg.text?.substring(0, 100),
        receivedAt: msg.createdAt
      }));

      logDebug('Listed emails for user', { userId, count: emails.length });

      return { success: true, emails };
    } catch (error: any) {
      logError('Failed to list emails', error, { userId });
      return { success: false, error: error.message || 'Failed to list emails' };
    }
  }

  async getEmail(
    userId: string,
    messageId: string
  ): Promise<{ success: boolean; email?: any; error?: string }> {
    if (!this.client) {
      this.initialize();
      if (!this.client) {
        return { success: false, error: 'AgentMail not configured' };
      }
    }

    try {
      const inbox = await this.getInboxByUserId(userId);
      if (!inbox) {
        return { success: false, error: 'No inbox found for user' };
      }

      const message = await this.client.inboxes.messages.get(inbox.inboxId, messageId);

      const email = {
        messageId: message.messageId,
        threadId: message.threadId,
        from: message.from,
        to: message.to,
        cc: message.cc,
        subject: message.subject,
        text: message.text,
        html: message.html,
        receivedAt: message.createdAt,
        attachments: message.attachments
      };

      logDebug('Retrieved email', { userId, messageId });

      return { success: true, email };
    } catch (error: any) {
      logError('Failed to get email', error, { userId, messageId });
      return { success: false, error: error.message || 'Failed to get email' };
    }
  }

  async replyToEmail(
    userId: string,
    messageId: string,
    body: string,
    options?: { html?: string }
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.client) {
      this.initialize();
      if (!this.client) {
        return { success: false, error: 'AgentMail not configured' };
      }
    }

    try {
      const inbox = await this.getInboxByUserId(userId);
      if (!inbox) {
        return { success: false, error: 'No inbox found for user' };
      }

      logInfo('Replying to email via AgentMail', {
        userId,
        originalMessageId: messageId
      });

      const reply = await this.client.inboxes.messages.reply(inbox.inboxId, messageId, {
        text: body,
        html: options?.html
      });

      logInfo('Email reply sent successfully', {
        userId,
        replyMessageId: reply.messageId
      });

      return { success: true, messageId: reply.messageId };
    } catch (error: any) {
      logError('Failed to reply to email', error, { userId, messageId });
      return { success: false, error: error.message || 'Failed to reply to email' };
    }
  }

  async getAgentEmailAddress(userId: string): Promise<string | null> {
    const inbox = await this.getOrCreateInbox(userId);
    return inbox?.emailAddress || null;
  }
}

// Singleton instance
let agentMailClientInstance: AgentMailClient | null = null;

export const getAgentMailClient = (): AgentMailClient => {
  if (!agentMailClientInstance) {
    agentMailClientInstance = new AgentMailClient();
  }
  return agentMailClientInstance;
};

export { AgentMailClient };
