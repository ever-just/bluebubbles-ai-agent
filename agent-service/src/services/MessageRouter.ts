import { Repository, IsNull, Not } from 'typeorm';
import { AppDataSource } from '../database/connection';
import { User } from '../database/entities/User';
import { Conversation } from '../database/entities/Conversation';
import { Message } from '../database/entities/Message';
import { BlueBubblesClient } from '../integrations/BlueBubblesClient';
import { ClaudeServiceEnhanced, getEnhancedClaudeService } from './ClaudeServiceEnhanced';
import { ContextService, getContextService } from './ContextService';
import { ReminderService } from './ReminderService';
import { logInfo, logError, logDebug, logWarn } from '../utils/logger';
import { ServiceResponse, BlueBubblesMessage, MessageMetadata, ContextMemory } from '../types';
import { getMessageHandlerFactory } from '../handlers/MessageHandlerFactory';
import { getSecurityManager } from '../middleware/security';
import { ToolExecutionContext } from '../tools/Tool';
import type { PromptRuntimeContext } from '../utils/SystemPromptBuilder';
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
  private readonly summaryTailLength = 6;
  private readonly duplicateWindowMs = 60_000;
  private readonly duplicateContentWindowMs = 45_000;
  private recentMessageCache = new Map<string, number>();
  private recentMessageContentCache = new Map<string, { normalized: string; timestamp: number }>();
  private recentOutboundMessages = new Map<string, { hash: string; timestamp: number }[]>();
  private outboundMessageTtlMs = 2 * 60_000;
  private blueBubblesPollingDisabled = false;

  constructor() {
    this.userRepo = AppDataSource.getRepository(User);
    this.conversationRepo = AppDataSource.getRepository(Conversation);
    this.messageRepo = AppDataSource.getRepository(Message);
    this.blueBubblesClient = new BlueBubblesClient();
    this.claudeService = getEnhancedClaudeService();
    this.contextService = getContextService();
    this.reminderService = new ReminderService();
  }

  private async buildPromptRuntimeContext(
    user: User,
    conversation: Conversation,
    conversationHistory: Array<{ role: string; content: string }>
  ): Promise<PromptRuntimeContext> {
    const userProfile: Record<string, string | undefined> = {
      phoneNumber: user.phoneNumber,
      email: user.email,
      timezone: user.preferences?.timezone
    };

    const userPreferences = Object.entries(user.preferences ?? {})
      .filter(([key, value]) => value !== undefined && value !== null && typeof value !== 'object')
      .map(([key, value]) => `${this.formatPromptLabel(key)}: ${String(value)}`)
      .slice(0, 6);

    const recentMessages = conversationHistory
      .slice(-20)
      .map(turn => `${turn.role === 'assistant' ? 'Grace' : 'User'}: ${turn.content}`);

    const summary = typeof conversation.metadata?.summary === 'string'
      ? conversation.metadata.summary
      : undefined;

    const activeTasks = Array.isArray(conversation.metadata?.activeTasks)
      ? conversation.metadata.activeTasks.map((task: any) => this.formatListItem(task, 180)).slice(0, 5)
      : undefined;

    const activeReminders = Array.isArray(conversation.metadata?.activeReminders)
      ? conversation.metadata.activeReminders.map((reminder: any) => this.formatListItem(reminder, 180)).slice(0, 5)
      : undefined;

    const [sessionMemories, longTermMemories] = await Promise.all([
      this.contextService.getUserMemories(user.id, 'session', conversation.id),
      this.contextService.getUserMemories(user.id, 'long_term')
    ]);

    const sessionHighlights = this.extractMemoryHighlights(sessionMemories, 5);
    const remainingBudget = Math.max(0, 5 - sessionHighlights.length);
    const longTermHighlights = remainingBudget > 0
      ? this.extractMemoryHighlights(longTermMemories, remainingBudget)
      : [];

    const memoryHighlights = [...sessionHighlights, ...longTermHighlights];

    const additionalNotes = Array.isArray(conversation.metadata?.notes)
      ? conversation.metadata.notes.map((note: any) => this.formatListItem(note, 200)).slice(0, 3)
      : undefined;

    const conversationGoals = Array.isArray(conversation.metadata?.goals)
      ? conversation.metadata.goals.map((goal: any) => this.formatListItem(goal, 180)).slice(0, 3)
      : undefined;

    return {
      currentDatetime: new Date().toISOString(),
      userProfile,
      userPreferences: userPreferences.length > 0 ? userPreferences : undefined,
      memoryHighlights: memoryHighlights.length > 0 ? memoryHighlights : undefined,
      activeTasks,
      activeReminders,
      conversationSummary: summary,
      recentMessages: recentMessages.length > 0 ? recentMessages : undefined,
      conversationGoals,
      additionalNotes
    };
  }

  private extractMemoryHighlights(
    response: ServiceResponse<ContextMemory[]>,
    limit: number
  ): string[] {
    if (!response?.success || !response.data || response.data.length === 0 || limit <= 0) {
      return [];
    }

    return response.data
      .slice(0, limit)
      .map(memory => `${this.formatPromptLabel(memory.key)}: ${this.formatListItem(memory.value, 220)}`);
  }

  private formatPromptLabel(value: string): string {
    return value
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^./, char => char.toUpperCase());
  }

  private formatListItem(raw: unknown, maxLength: number): string {
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, maxLength - 1)}…`;
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

  private recordOutboundMessage(conversationId: string, text: string): void {
    const normalized = this.normalizeMessageText(text);
    if (!normalized) {
      return;
    }

    const existing = this.recentOutboundMessages.get(conversationId) ?? [];
    const now = Date.now();
    const filtered = existing.filter(entry => now - entry.timestamp < this.outboundMessageTtlMs);
    filtered.push({ hash: normalized, timestamp: now });
    this.recentOutboundMessages.set(conversationId, filtered);
  }

  private isRecentAssistantEcho(conversationId: string, bbMessage: BlueBubblesMessage, text?: string | null): boolean {
    const hasHandle = Boolean(bbMessage.handle?.address || bbMessage.handle?.identifier || bbMessage.handle_id);
    const normalized = this.normalizeMessageText(text ?? '');
    if (!hasHandle) {
      return true;
    }

    if (!normalized) {
      return false;
    }

    const entries = this.recentOutboundMessages.get(conversationId);
    if (!entries || entries.length === 0) {
      return false;
    }

    const now = Date.now();
    const remaining: { hash: string; timestamp: number }[] = [];
    let matched = false;
    for (const entry of entries) {
      if (now - entry.timestamp >= this.outboundMessageTtlMs) {
        continue;
      }
      if (!matched && entry.hash === normalized) {
        matched = true;
        continue;
      }
      remaining.push(entry);
    }

    if (remaining.length > 0) {
      this.recentOutboundMessages.set(conversationId, remaining);
    } else {
      this.recentOutboundMessages.delete(conversationId);
    }

    return matched;
  }

  private normalizeMessageText(text: string): string {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
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
        logWarn('BlueBubbles connection failed during startup - continuing with HTTP polling only', {
          error: (blueBubblesError as Error).message
        });
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
      if (this.blueBubblesPollingDisabled) {
        return;
      }

      console.log('🔄 HTTP POLLING: Checking BlueBubbles API availability...');
      try {
        // Test basic API connectivity
        const serverInfoUrl = new URL('/api/v1/server/info', config.bluebubbles.url.endsWith('/') ? config.bluebubbles.url : `${config.bluebubbles.url}/`);
        serverInfoUrl.searchParams.set('password', config.bluebubbles.password);

        const serverResponse = await fetch(serverInfoUrl.toString());
        if (serverResponse.ok) {
          await serverResponse.json();
          console.log('🔄 HTTP POLLING: BlueBubbles API accessible');

          // TODO: Implement message detection when API endpoints become available
          // For now, we rely on manual message injection via /api/test-message
          // or webhook injection when Private API compatibility is resolved

          console.log('🔄 HTTP POLLING: Ready for manual message injection');
        } else if (serverResponse.status === 401) {
          logError('BlueBubbles API authentication failed - disabling HTTP polling until credentials are corrected');
          this.blueBubblesPollingDisabled = true;
        } else {
          console.log('🔄 HTTP POLLING: BlueBubbles API not accessible');
        }
      } catch (error) {
        if ((error as Error)?.message?.includes('401')) {
          logError('BlueBubbles API authentication failed - disabling HTTP polling until credentials are corrected', error);
          this.blueBubblesPollingDisabled = true;
          return;
        }
        console.log('🔄 HTTP POLLING: Network error:', (error as Error).message);
      }
    }, 30000); // Check every 30 seconds

    logInfo('HTTP polling started - manual message injection available via /api/test-message');
  }

  async handleIncomingMessage(bbMessage: BlueBubblesMessage): Promise<void> {
    let user: User | null = null;
    let conversation: Conversation | null = null;
    let chatGuid: string | null = null;
    let typingStarted = false;
    let typingGuid: string | null = null;

    try {
      logInfo('Processing incoming message', {
        guid: bbMessage.guid,
        chat: bbMessage.chat_id,
        text: bbMessage.text?.substring(0, 50),
        isFromMe: bbMessage.is_from_me
      });

      // Skip if message is from the AI (sent by us)
      if (bbMessage.is_from_me) {
        logDebug('Skipping self-sent message (flagged by BlueBubbles)');
        return;
      }

      if (this.isDuplicateMessage(bbMessage.guid)) {
        logWarn('Duplicate BlueBubbles message detected - skipping processing', { guid: bbMessage.guid });
        return;
      }

      if (this.isDuplicateMessageContent(bbMessage)) {
        logInfo('Duplicate BlueBubbles message content detected - skipping processing', {
          guid: bbMessage.guid,
          chatId: bbMessage.chat_id,
          handle: bbMessage.handle?.address,
          preview: bbMessage.text?.substring(0, 80)
        });
        return;
      }

      const processedMessage = await this.messageHandlerFactory.processMessage(bbMessage);
      if (!processedMessage) {
        logDebug('Message skipped by handlers (empty or unsupported type)');
        return;
      }

      // Get or create user based on chat identifier
      user = await this.getOrCreateUserFromMessage(bbMessage);
      if (!user) {
        logError('Failed to identify user from message');
        return;
      }

      const userHandle = bbMessage.handle?.address || user.phoneNumber || 'unknown';

      const resolvedChatGuid = await this.determineChatGuid(bbMessage, user);
      if (resolvedChatGuid && !bbMessage.chat_id) {
        bbMessage.chat_id = resolvedChatGuid;
      }

      bbMessage.metadata = {
        ...(bbMessage.metadata || {}),
        resolvedChatGuid,
        originalChatId: bbMessage.metadata?.originalChatId ?? bbMessage.chat_id
      };

      // Get or create conversation
      conversation = await this.getOrCreateConversation(
        user.id,
        'imessage',
        bbMessage.chat_id ?? undefined
      );

      if (config.messaging.typingIndicators && !typingStarted) {
        typingGuid = bbMessage.chat_id || conversation.channelConversationId || resolvedChatGuid || null;
        if (typingGuid) {
          await this.blueBubblesClient.startTypingIndicator(typingGuid);
          typingStarted = true;
        }
      }

      if (this.isRecentAssistantEcho(conversation.id, bbMessage, processedMessage.text)) {
        logDebug('Skipping assistant echo detected via outbound cache', {
          guid: bbMessage.guid,
          conversationId: conversation.id
        });
        return;
      }

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
      const rawConversationHistory = await this.getConversationHistory(conversation.id, 35);
      const conversationHistory = await this.prepareConversationHistory(
        user.id,
        conversation,
        rawConversationHistory,
        messageText
      );

      const chatGuidForRead = bbMessage.chat_id
        || conversation.channelConversationId
        || bbMessage.metadata?.resolvedChatGuid
        || await this.determineChatGuid(bbMessage, user);

      if (chatGuidForRead && config.bluebubbles.markChatsRead) {
        try {
          await this.blueBubblesClient.markChatRead(chatGuidForRead);
          logDebug('Marked chat as read via BlueBubbles private API', {
            chatGuid: chatGuidForRead,
            conversationId: conversation.id
          });
        } catch (error) {
          logWarn('Failed to mark chat read via BlueBubbles', {
            chatGuid: chatGuidForRead,
            conversationId: conversation.id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      // Create tool execution context
      const runtimeContext = await this.buildPromptRuntimeContext(user, conversation, conversationHistory);

      const toolContext: ToolExecutionContext = {
        userHandle,
        userId: user.id,
        conversationId: conversation.id,
        isAdmin: userHandle !== 'unknown' && this.securityManager.isAdmin(userHandle),
        runtimeContext
      };

      // Get AI response with tools and multi-modal support
      const aiResponse = await this.claudeService.sendMessage(
        [processedMessage],
        conversationHistory,
        toolContext
      );

      chatGuid = await this.resolveChatGuid(conversation, bbMessage, user);

      if (typingStarted && typingGuid) {
        await this.blueBubblesClient.stopTypingIndicator(typingGuid);
        typingStarted = false;
        typingGuid = null;
      }

      if (aiResponse.success && aiResponse.data) {
        const sendEnabled = config.bluebubbles.sendEnabled;

        if (!sendEnabled) {
          logWarn('Skipping assistant response because BlueBubbles sending is disabled', {
            conversationId: conversation.id
          });
        }

        if (sendEnabled) {
          const assistantMessages = this.prepareAssistantMessages(aiResponse.data.content);
          const burstDelayMs = config.messaging.responseBurstDelayMs;

          chatGuid = chatGuid ?? bbMessage.chat_id ?? conversation?.channelConversationId ?? null;

          if (!chatGuid) {
            logError('No chat GUID available to send response', {
              conversationId: conversation.id,
              incomingChatId: bbMessage.chat_id
            });
          } else {
            for (let i = 0; i < assistantMessages.length; i += 1) {
              const part = assistantMessages[i];
              const metadata = {
                source: 'bluebubbles',
                tokensUsed: i === 0 ? aiResponse.data.tokensUsed : undefined,
                inputTokens: i === 0 ? aiResponse.data.metadata?.usage?.input_tokens : undefined,
                toolsUsed: i === 0 ? aiResponse.data.toolsUsed : undefined
              } as MessageMetadata;

              await this.saveMessage(
                user.id,
                conversation.id,
                'assistant',
                part,
                metadata
              );

              await this.sendBlueBubblesMessage(chatGuid, part, 'assistant-response', conversation.id);

              if (i < assistantMessages.length - 1 && burstDelayMs > 0) {
                await this.delay(burstDelayMs);
              }
            }
          }
        }
      } else {
        logError('Failed to get AI response', { 
          error: aiResponse.error,
          errorDetails: JSON.stringify(aiResponse, null, 2)
        });
        
        // Send error message to user (only if we have chat_id)
        if (chatGuid) {
          await this.sendBlueBubblesMessage(chatGuid, "I'm having trouble processing your message right now. Please try again later.", 'error-response', conversation?.id);
        }
      }
    } catch (error) {
      logError('Error handling incoming message', error);

      // Try to send error message if we have chat_id
      if (!chatGuid) {
        if (!conversation || !user) {
          const context = await this.ensureConversationContext(bbMessage);
          conversation = context.conversation;
          user = context.user;
        }

        if (conversation && user) {
          chatGuid = await this.resolveChatGuid(conversation, bbMessage, user);
        }
      }

      if (chatGuid && config.bluebubbles.sendEnabled) {
        await this.sendBlueBubblesMessage(chatGuid, "I encountered an error processing your message. Please try again.", 'error-catch', conversation?.id);
      }
    } finally {
      if (typingStarted && typingGuid && config.messaging.typingIndicators) {
        try {
          await this.blueBubblesClient.stopTypingIndicator(typingGuid);
        } catch (error) {
          logWarn('Failed to stop typing indicator during cleanup', {
            chatGuid: typingGuid,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
  }

  private prepareAssistantMessages(content: string): string[] {
    const delimiterPattern = /\s*\|\|\s*/;
    const parts = content
      .split(delimiterPattern)
      .map(part => part.trim())
      .filter(part => part.length > 0);

    if (parts.length === 0) {
      return [content.trim()];
    }

    const maxBurst = Math.max(1, config.messaging.maxResponseBurst || 3);
    if (parts.length <= maxBurst) {
      return parts;
    }

    const limited = parts.slice(0, maxBurst - 1);
    const remainder = parts.slice(maxBurst - 1).join(' ');
    limited.push(remainder.trim());
    return limited.filter(part => part.length > 0);
  }

  private async delay(ms: number): Promise<void> {
    if (ms <= 0) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  private async ensureConversationContext(bbMessage: BlueBubblesMessage): Promise<{ conversation: Conversation | null; user: User | null }> {
    try {
      const user = await this.getOrCreateUserFromMessage(bbMessage);
      if (!user) {
        return { conversation: null, user: null };
      }

      const conversation = await this.getOrCreateConversation(user.id, 'imessage', bbMessage.chat_id ?? undefined);
      return { conversation, user };
    } catch (error) {
      logWarn('Failed to ensure conversation context after error', {
        guid: bbMessage.guid,
        error: error instanceof Error ? error.message : String(error)
      });
      return { conversation: null, user: null };
    }
  }

  private async resolveChatGuid(
    conversation: Conversation,
    bbMessage: BlueBubblesMessage,
    user: User
  ): Promise<string | null> {
    const chatGuid = bbMessage.chat_id || conversation.channelConversationId;

    if (chatGuid) {
      return chatGuid;
    }

    const handleAddress = bbMessage.handle?.address || user.phoneNumber;
    if (!handleAddress) {
      return null;
    }

    try {
      const resolvedGuid = await this.blueBubblesClient.findChatGuidByHandle(handleAddress);
      if (resolvedGuid) {
        if (conversation.channelConversationId !== resolvedGuid) {
          try {
            await this.conversationRepo.update(conversation.id, { channelConversationId: resolvedGuid } as any);
            conversation.channelConversationId = resolvedGuid;
          } catch (error) {
            logWarn('Failed to persist resolved chat guid', {
              conversationId: conversation.id,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }

        return resolvedGuid;
      }
    } catch (error) {
      logWarn('Unable to resolve chat guid from BlueBubbles', {
        handleAddress,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    return null;
  }

  private isDuplicateMessage(guid?: string): boolean {
    if (!guid) {
      return false;
    }

    const now = Date.now();

    for (const [storedGuid, timestamp] of this.recentMessageCache) {
      if (now - timestamp > this.duplicateWindowMs) {
        this.recentMessageCache.delete(storedGuid);
      }
    }

    const lastSeen = this.recentMessageCache.get(guid);
    if (lastSeen && now - lastSeen < this.duplicateWindowMs) {
      return true;
    }

    this.recentMessageCache.set(guid, now);
    return false;
  }

  private isDuplicateMessageContent(bbMessage: BlueBubblesMessage): boolean {
    const text = bbMessage.text?.trim();
    if (!text) {
      return false;
    }

    const cacheKey = bbMessage.chat_id || bbMessage.handle?.address || 'global';
    const normalized = text.toLowerCase();
    const now = Date.now();

    for (const [key, entry] of this.recentMessageContentCache) {
      if (now - entry.timestamp > this.duplicateContentWindowMs) {
        this.recentMessageContentCache.delete(key);
      }
    }

    const existing = this.recentMessageContentCache.get(cacheKey);
    if (existing && existing.normalized === normalized && now - existing.timestamp < this.duplicateContentWindowMs) {
      return true;
    }

    this.recentMessageContentCache.set(cacheKey, { normalized, timestamp: now });
    return false;
  }

  private async sendBlueBubblesMessage(chatGuid: string, text: string, context: string, conversationId?: string) {
    if (!config.bluebubbles.sendEnabled) {
      logWarn('BlueBubbles sending disabled via config - skipping outbound message', { chatGuid, context });
      return;
    }

    if (conversationId) {
      this.recordOutboundMessage(conversationId, text);
    }

    try {
      await this.blueBubblesClient.sendMessage(chatGuid, text);
    } catch (error) {
      logError('Failed to send BlueBubbles message', error, { chatGuid, context });
      throw error;
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
    channelConversationId?: string
  ): Promise<Conversation> {
    const normalizedChannelId = channelConversationId?.trim() || null;

    let conversation: Conversation | null = null;

    if (normalizedChannelId) {
      conversation = await this.conversationRepo.findOne({
        where: {
          userId,
          channel,
          channelConversationId: normalizedChannelId
        }
      });
    }

    if (!conversation) {
      conversation = await this.conversationRepo.findOne({
        where: {
          userId,
          channel,
          channelConversationId: IsNull()
        }
      });

      if (conversation && normalizedChannelId && !conversation.channelConversationId) {
        logInfo('Backfilling missing conversation channel GUID', {
          conversationId: conversation.id,
          channelConversationId: normalizedChannelId
        });
        conversation.channelConversationId = normalizedChannelId;
      }
    }

    if (!conversation) {
      conversation = this.conversationRepo.create({
        userId,
        channel,
        channelConversationId: normalizedChannelId ?? undefined,
        metadata: {}
      });
      
      conversation = await this.conversationRepo.save(conversation);
      logInfo('Created new conversation', { id: conversation.id, channelConversationId: normalizedChannelId });
    }

    conversation.lastMessageAt = new Date();

    if (normalizedChannelId && conversation.channelConversationId !== normalizedChannelId) {
      conversation.channelConversationId = normalizedChannelId;
    }

    await this.conversationRepo.save(conversation);

    return conversation;
  }

  private async determineChatGuid(bbMessage: BlueBubblesMessage, user: User | null): Promise<string | null> {
    const directGuid = bbMessage.chat_id?.trim();
    if (directGuid) {
      return directGuid;
    }

    const metadataGuid = bbMessage.metadata?.resolvedChatGuid?.trim();
    if (metadataGuid) {
      return metadataGuid;
    }

    if (user) {
      const priorConversation = await this.conversationRepo.findOne({
        where: {
          userId: user.id,
          channel: 'imessage',
          channelConversationId: Not(IsNull())
        },
        order: { lastMessageAt: 'DESC' }
      });

      if (priorConversation?.channelConversationId) {
        return priorConversation.channelConversationId;
      }
    }

    const handleAddress = bbMessage.handle?.address || user?.phoneNumber;
    if (handleAddress) {
      try {
        const resolved = await this.blueBubblesClient.findChatGuidByHandle(handleAddress);
        if (resolved) {
          return resolved;
        }
      } catch (error) {
        logWarn('Failed to resolve chat guid via BlueBubbles handle lookup', {
          handleAddress,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return null;
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
