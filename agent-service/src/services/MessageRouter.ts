import { Repository } from 'typeorm';
import { AppDataSource } from '../database/connection';
import { User } from '../database/entities/User';
import { Conversation } from '../database/entities/Conversation';
import { Message } from '../database/entities/Message';
import { BlueBubblesClient } from '../integrations/BlueBubblesClient';
import { ClaudeServiceEnhanced, getEnhancedClaudeService } from './ClaudeServiceEnhanced';
import { ContextService, getContextService } from './ContextService';
import { ReminderService } from './ReminderService';
import { logInfo, logError, logDebug, logWarn } from '../utils/logger';
import { ServiceResponse, BlueBubblesMessage, MessageMetadata } from '../types';
import { getMessageHandlerFactory } from '../handlers/MessageHandlerFactory';
import { getSecurityManager } from '../middleware/security';
import { ToolExecutionContext } from '../tools/Tool';
import { config } from '../config';
import { getConversationSummarizer } from './ConversationSummarizer';
import type { ConversationTurn } from './ConversationSummarizer';

export class MessageRouter {
  private userRepo: Repository<User>;
  private conversationRepo: Repository<Conversation>;
  private messageRepo: Repository<Message>;
  private blueBubblesClient: BlueBubblesClient;
  private claudeService: ClaudeServiceEnhanced;
  private contextService: ContextService;
  private reminderService: ReminderService;
  private messageHandlerFactory = getMessageHandlerFactory();
  private securityManager = getSecurityManager();
  private conversationSummarizer = getConversationSummarizer();
  private readonly summaryTailLength = 8;

  constructor() {
    this.userRepo = AppDataSource.getRepository(User);
    this.conversationRepo = AppDataSource.getRepository(Conversation);
    this.messageRepo = AppDataSource.getRepository(Message);
    this.blueBubblesClient = new BlueBubblesClient();
    this.claudeService = getEnhancedClaudeService();
    this.contextService = getContextService();
    this.reminderService = new ReminderService();
  }

  private estimateTokenUsage(history: Array<{ role: string; content: string }>, latestMessage?: string) {
    const averageTokensPerChar = 0.25;
    const historyLength = history.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
    const latestLength = latestMessage?.length || 0;

    const inputTokens = Math.ceil((historyLength + latestLength) * averageTokensPerChar);
    const outputTokens = Math.ceil(800 * averageTokensPerChar);

    return {
      input: inputTokens,
      output: outputTokens
    };
  }

  async initialize(): Promise<void> {
    try {
      // Try to connect to BlueBubbles, but don't block server startup if it fails
      try {
        await this.blueBubblesClient.connect();
        
        // Set up message listeners only if connected
        this.blueBubblesClient.on('message', async (message: BlueBubblesMessage) => {
          await this.handleIncomingMessage(message);
        });
      } catch (blueBubblesError) {
        logWarn('BlueBubbles connection failed during startup - continuing with HTTP polling only', { error: (blueBubblesError as Error).message });
      }

      // Always start HTTP polling as backup
      this.startMessagePolling();

      logInfo('Message router initialized (HTTP polling active)');
    } catch (error) {
      logError('Failed to initialize message router', error);
      throw error; // This is a fatal error
    }
  }

  private startMessagePolling(): void {
    // HTTP polling for new messages (works without Private API)
    setInterval(async () => {
      console.log('🔄 HTTP POLLING: Checking BlueBubbles API availability...');
      try {
        // Test basic API connectivity
        const serverResponse = await fetch(`http://localhost:1234/api/v1/server/info?password=bluebubbles123`);
        if (serverResponse.ok) {
          const serverData = await serverResponse.json();
          console.log('🔄 HTTP POLLING: BlueBubbles API accessible');

          // TODO: Implement message detection when API endpoints become available
          // For now, we rely on manual message injection via /api/test-message
          // or webhook injection when Private API compatibility is resolved

          console.log('🔄 HTTP POLLING: Ready for manual message injection');
        } else {
          console.log('🔄 HTTP POLLING: BlueBubbles API not accessible');
        }
      } catch (error) {
        console.log('🔄 HTTP POLLING: Network error:', (error as Error).message);
      }
    }, 30000); // Check every 30 seconds

    logInfo('HTTP polling started - manual message injection available via /api/test-message');
  }

  async handleIncomingMessage(bbMessage: BlueBubblesMessage): Promise<void> {
    try {
      logInfo('Processing incoming message', {
        guid: bbMessage.guid,
        chat: bbMessage.chat_id,
        text: bbMessage.text?.substring(0, 50),
        isFromMe: bbMessage.is_from_me
      });

      // Skip if message is from the AI (sent by us)
      if (bbMessage.is_from_me) {
        logDebug('Skipping self-sent message');
        return;
      }

      // Process message through handler factory
      const processedMessage = await this.messageHandlerFactory.processMessage(bbMessage);
      if (!processedMessage) {
        logDebug('Message skipped by handlers (empty or unsupported type)');
        return;
      }

      // Get or create user based on chat identifier
      const user = await this.getOrCreateUserFromMessage(bbMessage);
      if (!user) {
        logError('Failed to identify user from message');
        return;
      }

      // Get user handle for context
      const userHandle = bbMessage.handle?.address || 'unknown';

      // Get or create conversation
      const conversation = await this.getOrCreateConversation(
        user.id,
        'imessage',
        bbMessage.chat_id
      );

      // Save incoming message to database
      const messageText = processedMessage.text || '[Non-text content]';
      await this.saveMessage(
        user.id,
        conversation.id,
        'user',
        messageText,
        {
          source: 'bluebubbles',
          originalMessageId: bbMessage.guid,
          attachments: bbMessage.attachments,
          messageType: processedMessage.metadata.originalType
        }
      );

      // Get conversation history and trim with summarization if needed
      const rawConversationHistory = await this.getConversationHistory(conversation.id, 50);
      const conversationHistory = await this.prepareConversationHistory(
        user.id,
        conversation,
        rawConversationHistory,
        messageText
      );

      // Create tool execution context
      const toolContext: ToolExecutionContext = {
        userHandle,
        userId: user.id,
        conversationId: conversation.id,
        isAdmin: this.securityManager.isAdmin(userHandle)
      };

      // Get AI response with tools and multi-modal support
      const aiResponse = await this.claudeService.sendMessage(
        [processedMessage],
        conversationHistory,
        toolContext
      );

      if (aiResponse.success && aiResponse.data) {
        // Save AI response to database
        await this.saveMessage(
          user.id,
          conversation.id,
          'assistant',
          aiResponse.data.content,
          {
            source: 'bluebubbles',
            tokensUsed: aiResponse.data.tokensUsed,
            inputTokens: aiResponse.data.metadata?.usage?.input_tokens,
            toolsUsed: aiResponse.data.toolsUsed
          }
        );

        // Send response back through BlueBubbles
        const chatGuid = bbMessage.chat_id || conversation.channelConversationId;

        if (chatGuid) {
          await this.blueBubblesClient.sendMessage(
            chatGuid,
            aiResponse.data.content
          );
        } else {
          logError('No chat GUID available to send response', {
            conversationId: conversation.id,
            incomingChatId: bbMessage.chat_id
          });
        }
      } else {
        logError('Failed to get AI response', { 
          error: aiResponse.error,
          errorDetails: JSON.stringify(aiResponse, null, 2)
        });
        
        // Send error message to user (only if we have chat_id)
        if (bbMessage.chat_id) {
          await this.blueBubblesClient.sendMessage(
            bbMessage.chat_id,
            "I'm having trouble processing your message right now. Please try again later."
          );
        }
      }
    } catch (error) {
      logError('Error handling incoming message', error);
      
      // Try to send error message if we have chat_id
      if (bbMessage.chat_id) {
        try {
          await this.blueBubblesClient.sendMessage(
            bbMessage.chat_id,
            "I encountered an error processing your message. Please try again."
          );
        } catch (sendError) {
          logError('Failed to send error message', sendError);
        }
      }
    }
  }

  private async prepareConversationHistory(
    userId: string,
    conversation: Conversation,
    history: Array<{ role: string; content: string }>,
    latestMessage?: string
  ): Promise<Array<{ role: string; content: string }>> {
    const summaryTrigger = config.anthropic.summaryTriggerTokens ?? Math.floor((config.anthropic.contextWindowTokens ?? 6000) * 0.7);
    const contextWindow = config.anthropic.contextWindowTokens ?? summaryTrigger + 1000;
    const { input: inputTokens } = this.estimateTokenUsage(history, latestMessage);

    if (inputTokens <= summaryTrigger) {
      return history;
    }

    const summarySourceCount = Math.max(history.length - this.summaryTailLength, 0);
    if (summarySourceCount <= 0) {
      return history;
    }

    const summarySource: ConversationTurn[] = history
      .slice(0, summarySourceCount)
      .filter(turn => turn.content && turn.content.trim().length > 0)
      .map(turn => ({
        role: turn.role === 'assistant' ? 'assistant' : 'user',
        content: turn.content
      }));

    if (summarySource.length === 0) {
      return history;
    }

    try {
      const summary = await this.conversationSummarizer.summarize(summarySource);
      if (!summary) {
        return history;
      }

      const summaryMessage = {
        role: 'assistant',
        content: `Summary so far:\n${summary}`
      };

      const tailMessages = history.slice(-this.summaryTailLength);
      const trimmedHistory = await this.enforceContextWindow(summaryMessage, tailMessages, latestMessage, contextWindow);

      void this.persistConversationSummary(userId, conversation, summary);

      return trimmedHistory;
    } catch (error) {
      logWarn('Failed to summarize conversation context', {
        error: error instanceof Error ? error.message : String(error)
      });
      return history;
    }
  }

  private async enforceContextWindow(
    summaryMessage: { role: string; content: string },
    tailMessages: Array<{ role: string; content: string }>,
    latestMessage: string | undefined,
    contextWindow: number
  ): Promise<Array<{ role: string; content: string }>> {
    const mutableTail = [...tailMessages];
    let candidateHistory = [summaryMessage, ...mutableTail];
    let { input } = this.estimateTokenUsage(candidateHistory, latestMessage);

    while (input > contextWindow && mutableTail.length > 1) {
      mutableTail.shift();
      candidateHistory = [summaryMessage, ...mutableTail];
      ({ input } = this.estimateTokenUsage(candidateHistory, latestMessage));
    }

    return candidateHistory;
  }

  private async persistConversationSummary(
    userId: string,
    conversation: Conversation,
    summary: string
  ): Promise<void> {
    try {
      const memoryResult = await this.contextService.saveMemory(
        userId,
        'conversation_summary',
        summary,
        'session',
        conversation.id,
        {
          generatedAt: new Date().toISOString()
        }
      );

      if (!memoryResult.success) {
        logWarn('Failed to save conversation summary memory', { error: memoryResult.error });
      }
    } catch (error) {
      logWarn('Error saving conversation summary memory', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    try {
      const metadata: Record<string, any> = {
        ...(conversation.metadata || {}),
        summary,
        summaryGeneratedAt: new Date().toISOString()
      };

      await this.conversationRepo.update(conversation.id, { metadata } as any);
      conversation.metadata = metadata;
    } catch (error) {
      logWarn('Error updating conversation metadata with summary', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async getOrCreateUserFromMessage(bbMessage: BlueBubblesMessage): Promise<User | null> {
    try {
      // Extract phone number from the message handle
      const phoneNumber = bbMessage.handle?.address;
      if (!phoneNumber) {
        logError('No phone number found in message handle', { handle: bbMessage.handle });
        return null;
      }

      logDebug('Extracted phone number from message', { phoneNumber });

      // Check if user exists
      let user = await this.userRepo.findOne({
        where: { phoneNumber }
      });

      // Create user if doesn't exist
      if (!user) {
        user = this.userRepo.create({
          phoneNumber,
          preferences: {
            aiPersonality: 'friendly',
            enableReminders: true,
            reminderChannelPreference: 'imessage'
          }
        });

        user = await this.userRepo.save(user);
        logInfo('Created new user', { id: user.id, phoneNumber });
      }

      return user;
    } catch (error) {
      logError('Failed to get or create user from message', { error });
      return null;
    }
  }

  private async getOrCreateConversation(
    userId: string,
    channel: 'imessage' | 'email',
    channelConversationId: string
  ): Promise<Conversation> {
    let conversation = await this.conversationRepo.findOne({
      where: {
        userId,
        channel,
        channelConversationId
      }
    });

    if (!conversation) {
      conversation = this.conversationRepo.create({
        userId,
        channel,
        channelConversationId,
        metadata: {}
      });
      
      conversation = await this.conversationRepo.save(conversation);
      logInfo('Created new conversation', { id: conversation.id });
    }

    // Update last message timestamp
    conversation.lastMessageAt = new Date();
    // Backfill missing channel conversation id if known
    if (!conversation.channelConversationId && channelConversationId) {
      conversation.channelConversationId = channelConversationId;
    }

    await this.conversationRepo.save(conversation);

    return conversation;
  }

  private async saveMessage(
    userId: string,
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    metadata: MessageMetadata = {}
  ): Promise<Message> {
    const message = this.messageRepo.create({
      userId,
      conversationId,
      role,
      content,
      metadata,
      tokensUsed: metadata.tokensUsed
    });

    const savedMessage = await this.messageRepo.save(message);
    logDebug('Message saved', { id: savedMessage.id, role });
    
    return savedMessage;
  }

  private async getConversationHistory(conversationId: string, limit: number = 20): Promise<Array<{role: string; content: string}>> {
    const messages = await this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
      take: limit
    });

    return messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  }

  // Note: Old methods removed - action items and context are now handled by tools and Claude directly

  async sendProactiveMessage(
    userId: string,
    message: string,
    channel: 'imessage' | 'email' = 'imessage'
  ): Promise<ServiceResponse<boolean>> {
    try {
      if (channel === 'imessage') {
        // Get user's phone number
        const user = await this.userRepo.findOne({
          where: { id: userId }
        });

        if (!user || !user.phoneNumber) {
          return {
            success: false,
            error: 'User phone number not found'
          };
        }

        // Find the chat ID for this user
        const conversation = await this.conversationRepo.findOne({
          where: {
            userId,
            channel: 'imessage'
          },
          order: { lastMessageAt: 'DESC' }
        });

        if (!conversation || !conversation.channelConversationId) {
          return {
            success: false,
            error: 'No iMessage conversation found for user'
          };
        }

        // Send the message
        await this.blueBubblesClient.sendMessage(
          conversation.channelConversationId,
          message
        );

        // Save the message to database
        await this.saveMessage(
          userId,
          conversation.id,
          'assistant',
          message,
          { source: 'system', type: 'proactive' }
        );

        return { success: true, data: true };
      }
      
      // Email sending would be implemented here when we add email support
      return {
        success: false,
        error: 'Email channel not yet implemented'
      };
    } catch (error: any) {
      logError('Failed to send proactive message', error);
      return {
        success: false,
        error: error.message || 'Failed to send message'
      };
    }
  }

  isBlueBubblesConnected(): boolean {
    return this.blueBubblesClient.isConnectedStatus();
  }
}

// Singleton instance
let messageRouterInstance: MessageRouter | null = null;

export const getMessageRouter = async (): Promise<MessageRouter> => {
  if (!messageRouterInstance) {
    messageRouterInstance = new MessageRouter();
    await messageRouterInstance.initialize();
  }
  return messageRouterInstance;
};

export default MessageRouter;
