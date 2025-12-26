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
// PromptRuntimeContext defined inline (SystemPromptBuilder module planned for Phase 4)
interface PromptRuntimeContext {
  currentDatetime: string;
  userProfile: Record<string, string | undefined>;
  userPreferences?: string[];
  memoryHighlights?: string[];
  activeTasks?: string[];
  activeReminders?: string[];
  conversationSummary?: string;
  recentMessages?: string[];
  conversationGoals?: string[];
  additionalNotes?: string[];
}
import { config } from '../config';
import { getConversationSummarizer } from './ConversationSummarizer';
import type { ConversationTurn } from './ConversationSummarizer';
import { createInteractionAgentRuntime, initializeIMessageAdapter } from '../agents';
import { createWorkingMemoryLog, WorkingMemoryLog } from './WorkingMemoryLog';
import { getSummarizationService } from './SummarizationService';

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
  private outboundMessageTtlMs = 5 * 60_000; // 5 minutes for echo detection
  
  // Global outbound cache - catches echoes before conversation is resolved
  private globalOutboundCache = new Map<string, number>(); // normalized text -> timestamp
  private readonly globalOutboundTtlMs = 5 * 60_000; // 5 minutes
  
  // Global processed GUID cache - prevents duplicate processing from socket + webhook
  // This is checked BEFORE debounce buffer to catch duplicates across all sources
  private processedGuidCache = new Map<string, number>(); // guid -> timestamp
  private readonly processedGuidTtlMs = 60_000; // 1 minute TTL
  
  private blueBubblesPollingDisabled = false;
  private dualAgentEnabled = false;
  private workingMemoryLogs = new Map<string, WorkingMemoryLog>();
  private summarizationService = getSummarizationService();
  
  // Message debounce: collect rapid messages before processing
  private messageDebounceBuffers = new Map<string, {
    messages: BlueBubblesMessage[];
    timer: NodeJS.Timeout | null;
  }>();
  private readonly debounceDelayMs = 2000; // 2 seconds
  
  // Startup protection: ignore messages received within first N seconds after startup
  private startupTime = Date.now();
  private readonly startupGracePeriodMs = 10_000; // 10 seconds
  private startupProtectionEnabled = true;
  
  // Response rate limiter: prevent runaway loops by limiting responses per conversation
  private responseRateLimiter = new Map<string, { count: number; windowStart: number }>();
  private readonly maxResponsesPerWindow = 5; // Max 5 responses per window
  private readonly rateLimitWindowMs = 30_000; // 30 second window

  constructor() {
    this.userRepo = AppDataSource.getRepository(User);
    this.conversationRepo = AppDataSource.getRepository(Conversation);
    this.messageRepo = AppDataSource.getRepository(Message);
    this.blueBubblesClient = new BlueBubblesClient();
    this.claudeService = getEnhancedClaudeService();
    this.contextService = getContextService();
    this.reminderService = new ReminderService();
    
    // Initialize dual-agent system if enabled
    this.dualAgentEnabled = config.agents?.enableDualAgent ?? false;
    if (this.dualAgentEnabled) {
      initializeIMessageAdapter(this.blueBubblesClient);
      logInfo('Dual-agent system enabled');
    }
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

    // Get summary from conversation metadata or WorkingMemoryLog
    let summary = typeof conversation.metadata?.summary === 'string'
      ? conversation.metadata.summary
      : undefined;
    
    // Also check WorkingMemoryLog for a more recent summary
    try {
      const workingMemoryLog = await this.getWorkingMemoryLog(user.id, conversation.id);
      const wmSummary = workingMemoryLog.getSummary();
      if (wmSummary && (!summary || wmSummary.length > summary.length)) {
        summary = wmSummary;
      }
    } catch (e) {
      // Ignore errors - summary is optional
    }

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

    // Format datetime in user's timezone (or default to America/Chicago)
    const userTimezone = user.preferences?.timezone || 'America/Chicago';
    const formattedDatetime = new Date().toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      timeZone: userTimezone
    });

    return {
      currentDatetime: formattedDatetime,
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

    const now = Date.now();
    
    // Record in conversation-specific cache
    const existing = this.recentOutboundMessages.get(conversationId) ?? [];
    const filtered = existing.filter(entry => now - entry.timestamp < this.outboundMessageTtlMs);
    filtered.push({ hash: normalized, timestamp: now });
    this.recentOutboundMessages.set(conversationId, filtered);
    
    // Also record in global cache for early echo detection
    this.globalOutboundCache.set(normalized, now);
    
    // Clean up old global entries
    for (const [hash, timestamp] of this.globalOutboundCache) {
      if (now - timestamp > this.globalOutboundTtlMs) {
        this.globalOutboundCache.delete(hash);
      }
    }
  }
  
  /**
   * Check if incoming message matches any recent outbound message globally.
   * This catches echoes before conversation ID is resolved.
   */
  private isGlobalOutboundEcho(text?: string | null): boolean {
    if (!text) return false;
    
    const normalized = this.normalizeMessageText(text);
    if (!normalized) return false;
    
    const timestamp = this.globalOutboundCache.get(normalized);
    if (timestamp && Date.now() - timestamp < this.globalOutboundTtlMs) {
      logInfo('Global echo detection: Message matches recent outbound', {
        textPreview: normalized.substring(0, 50),
        ageMs: Date.now() - timestamp
      });
      return true;
    }
    
    return false;
  }

  private isRecentAssistantEcho(conversationId: string, bbMessage: BlueBubblesMessage, text?: string | null): boolean {
    const hasHandle = Boolean(bbMessage.handle?.address || bbMessage.handle?.identifier || bbMessage.handle_id);
    const normalized = this.normalizeMessageText(text ?? '');
    
    if (!hasHandle) {
      logDebug('Echo check: No handle found - treating as echo', {
        guid: bbMessage.guid,
        conversationId
      });
      return true;
    }

    if (!normalized) {
      return false;
    }

    const entries = this.recentOutboundMessages.get(conversationId);
    if (!entries || entries.length === 0) {
      logDebug('Echo check: No recent outbound messages to compare', {
        guid: bbMessage.guid,
        conversationId,
        normalizedPreview: normalized.substring(0, 50)
      });
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
        logDebug('Echo check: MATCH FOUND - this is an echo of our outbound message', {
          guid: bbMessage.guid,
          conversationId,
          ageMs: now - entry.timestamp
        });
        continue;
      }
      remaining.push(entry);
    }

    if (remaining.length > 0) {
      this.recentOutboundMessages.set(conversationId, remaining);
    } else {
      this.recentOutboundMessages.delete(conversationId);
    }

    if (!matched) {
      logDebug('Echo check: No match in outbound cache - processing as new message', {
        guid: bbMessage.guid,
        conversationId,
        cachedCount: entries.length,
        normalizedPreview: normalized.substring(0, 50)
      });
    }

    return matched;
  }

  private normalizeMessageText(text: string): string {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /**
   * Check if we've hit the response rate limit for a conversation.
   * Returns true if rate limited (should NOT send response).
   */
  private isResponseRateLimited(conversationId: string): boolean {
    const now = Date.now();
    const limiter = this.responseRateLimiter.get(conversationId);
    
    if (!limiter) {
      // First response in this window
      this.responseRateLimiter.set(conversationId, { count: 1, windowStart: now });
      return false;
    }
    
    // Check if window has expired
    if (now - limiter.windowStart > this.rateLimitWindowMs) {
      // Reset window
      this.responseRateLimiter.set(conversationId, { count: 1, windowStart: now });
      return false;
    }
    
    // Within window - check count
    if (limiter.count >= this.maxResponsesPerWindow) {
      logWarn('Response rate limit hit - blocking response to prevent loop', {
        conversationId,
        count: limiter.count,
        maxAllowed: this.maxResponsesPerWindow,
        windowMs: this.rateLimitWindowMs,
        windowAgeMs: now - limiter.windowStart
      });
      return true;
    }
    
    // Increment count
    limiter.count++;
    return false;
  }

  /**
   * Get or create a working memory log for a user/conversation.
   */
  private async getWorkingMemoryLog(userId: string, conversationId: string): Promise<WorkingMemoryLog> {
    const key = `${userId}:${conversationId}`;
    
    let log = this.workingMemoryLogs.get(key);
    if (!log) {
      log = await createWorkingMemoryLog(userId, conversationId);
      this.workingMemoryLogs.set(key, log);
    }
    
    return log;
  }

  /**
   * Append a message to working memory and trigger summarization if needed.
   */
  private async appendToWorkingMemory(
    userId: string,
    conversationId: string,
    role: 'user' | 'assistant',
    content: string
  ): Promise<void> {
    try {
      const log = await this.getWorkingMemoryLog(userId, conversationId);
      
      log.append({
        role,
        content,
        timestamp: new Date()
      });

      // Check if summarization is needed
      if (log.needsSummarization()) {
        logInfo('Triggering working memory summarization', {
          userId,
          conversationId,
          entryCount: log.getEntryCount()
        });
        await this.summarizationService.checkAndSummarize(log);
      }

      // Save state periodically
      await log.save();
    } catch (error) {
      logWarn('Failed to append to working memory', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Check if a message is too old to process (backlog protection).
   * Messages older than maxAgeMs are considered stale and should be skipped.
   * 
   * BlueBubbles uses Apple Cocoa time: nanoseconds since Jan 1, 2001 (macOS 10.13+)
   * or seconds since Jan 1, 2001 (older macOS).
   */
  private isMessageTooOld(bbMessage: BlueBubblesMessage, maxAgeMs: number = 60_000): boolean {
    const messageTimestamp = bbMessage.date;
    if (!messageTimestamp) {
      // If no timestamp, assume it's recent
      return false;
    }
    
    // Convert Apple Cocoa time to Unix timestamp
    // Apple epoch is Jan 1, 2001 00:00:00 UTC
    const appleEpochMs = new Date('2001-01-01T00:00:00Z').getTime();
    
    // BlueBubbles sends nanoseconds since 2001 on macOS 10.13+
    // Divide by 10^6 to get milliseconds, then add Apple epoch
    const messageUnixMs = appleEpochMs + (messageTimestamp / 1_000_000);
    
    const messageAge = Date.now() - messageUnixMs;
    
    // Sanity check: if message appears to be from the future (negative age) or 
    // extremely old (> 24 hours), log a warning - this might indicate timestamp issues
    if (messageAge < -60_000) {
      logWarn('Message has future timestamp - possible clock skew', {
        guid: bbMessage.guid,
        messageAgeMs: Math.round(messageAge),
        textPreview: bbMessage.text?.substring(0, 30)
      });
      // Don't reject future messages - could be clock skew
    }
    
    if (messageAge > maxAgeMs) {
      logInfo('Skipping old message (backlog protection)', {
        guid: bbMessage.guid,
        messageAgeMs: Math.round(messageAge),
        messageAgeMinutes: Math.round(messageAge / 60_000),
        maxAgeMs,
        textPreview: bbMessage.text?.substring(0, 30),
        handle: bbMessage.handle?.address
      });
      return true;
    }
    
    return false;
  }

  /**
   * Check if a GUID has already been processed (prevents socket + webhook duplicates)
   */
  private isGuidAlreadyProcessed(guid?: string): boolean {
    if (!guid) {
      logInfo('isGuidAlreadyProcessed: No GUID provided');
      return false;
    }
    
    const now = Date.now();
    
    // Clean up expired entries
    for (const [storedGuid, timestamp] of this.processedGuidCache) {
      if (now - timestamp > this.processedGuidTtlMs) {
        this.processedGuidCache.delete(storedGuid);
      }
    }
    
    // Check if already processed
    if (this.processedGuidCache.has(guid)) {
      logInfo('isGuidAlreadyProcessed: GUID already in cache - DUPLICATE', { guid });
      return true;
    }
    
    // Mark as processed
    this.processedGuidCache.set(guid, now);
    logInfo('isGuidAlreadyProcessed: New GUID recorded', { guid, cacheSize: this.processedGuidCache.size });
    return false;
  }

  /**
   * Debounce incoming messages - collect rapid messages before processing.
   * This prevents multiple Claude calls when user sends several messages quickly.
   */
  private debounceMessage(bbMessage: BlueBubblesMessage): void {
    // Skip debounce during startup protection
    if (this.startupProtectionEnabled) {
      return;
    }
    
    // GLOBAL GUID CHECK: Prevent duplicate processing from socket + webhook
    // This must be checked FIRST, before any other logic
    if (this.isGuidAlreadyProcessed(bbMessage.guid)) {
      logInfo('Debounce: Skipping already-processed GUID (socket/webhook dedup)', {
        guid: bbMessage.guid,
        textPreview: bbMessage.text?.substring(0, 30)
      });
      return;
    }
    
    // Skip self-sent messages (check is_from_me flag)
    if (bbMessage.is_from_me) {
      logDebug('Debounce: Skipping self-sent message (is_from_me=true)', {
        guid: bbMessage.guid,
        textPreview: bbMessage.text?.substring(0, 30)
      });
      return;
    }
    
    // EARLY ECHO CHECK: Skip if this matches a recent outbound message
    // This catches echoes before they enter the debounce buffer
    if (this.isGlobalOutboundEcho(bbMessage.text)) {
      logInfo('Debounce: Skipping message - matches recent outbound (early echo detection)', {
        guid: bbMessage.guid,
        textPreview: bbMessage.text?.substring(0, 50)
      });
      return;
    }
    
    // Skip old messages (backlog protection) - ignore messages older than 2 minutes
    if (this.isMessageTooOld(bbMessage, 120_000)) {
      return;
    }
    
    const chatId = bbMessage.chat_id || bbMessage.handle?.address || 'unknown';
    
    let buffer = this.messageDebounceBuffers.get(chatId);
    if (!buffer) {
      buffer = { messages: [], timer: null };
      this.messageDebounceBuffers.set(chatId, buffer);
    }

    // Check for duplicate GUID in buffer (BlueBubbles sometimes sends same message twice)
    const existingGuids = buffer.messages.map(m => m.guid);
    if (bbMessage.guid && existingGuids.includes(bbMessage.guid)) {
      logDebug('Skipping duplicate GUID in debounce buffer', { guid: bbMessage.guid });
      return;
    }

    // Add message to buffer
    buffer.messages.push(bbMessage);
    
    logDebug('Message added to debounce buffer', {
      chatId,
      bufferSize: buffer.messages.length,
      textPreview: bbMessage.text?.substring(0, 30)
    });

    // Clear existing timer
    if (buffer.timer) {
      clearTimeout(buffer.timer);
    }

    // Set new timer
    buffer.timer = setTimeout(async () => {
      const messagesToProcess = buffer!.messages;
      this.messageDebounceBuffers.delete(chatId);
      
      if (messagesToProcess.length === 0) {
        return;
      }
      
      logInfo('Debounce timer expired - processing messages', {
        chatId,
        messageCount: messagesToProcess.length
      });
      
      // Process the last message but combine all message texts
      const lastMessage = messagesToProcess[messagesToProcess.length - 1];
      
      // Combine all message texts for context if multiple messages
      if (messagesToProcess.length > 1) {
        const combinedText = messagesToProcess
          .map(m => m.text || '')
          .filter(t => t.length > 0)
          .join('\n\n');
        lastMessage.text = combinedText;
        lastMessage.metadata = {
          ...lastMessage.metadata,
          combinedMessageCount: messagesToProcess.length,
          originalMessages: messagesToProcess.map(m => m.text?.substring(0, 50))
        };
        
        logInfo('Combined multiple rapid messages', {
          chatId,
          messageCount: messagesToProcess.length,
          combinedLength: combinedText.length
        });
      }
      
      await this.handleIncomingMessage(lastMessage);
    }, this.debounceDelayMs);
  }

  async initialize(): Promise<void> {
    // Record startup time for backlog protection
    this.startupTime = Date.now();
    this.startupProtectionEnabled = true;
    
    // Disable startup protection after grace period
    setTimeout(() => {
      this.startupProtectionEnabled = false;
      logInfo('Startup protection disabled - now processing new messages', {
        gracePeriodMs: this.startupGracePeriodMs
      });
    }, this.startupGracePeriodMs);
    
    try {
      // Try to connect to BlueBubbles, but don't block server startup if it fails
      try {
        await this.blueBubblesClient.connect();

        // NOTE: Socket message listener intentionally disabled
        // Messages are delivered via webhooks which is more reliable
        // Socket is still used for typing indicators and other real-time features
        // Having both socket + webhook causes duplicate processing and typing indicator issues
        logInfo('BlueBubbles socket connected (using webhooks for message delivery)');
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
    // HTTP polling to check BlueBubbles server availability
    // Note: Message fetching via /api/v1/message/query is not available in BlueBubbles
    // Messages are delivered via webhooks and WebSocket events
    setInterval(async () => {
      if (this.blueBubblesPollingDisabled) {
        return;
      }

      try {
        // Test basic API connectivity
        const serverInfoUrl = new URL('/api/v1/server/info', config.bluebubbles.url.endsWith('/') ? config.bluebubbles.url : `${config.bluebubbles.url}/`);
        serverInfoUrl.searchParams.set('password', config.bluebubbles.password);

        const serverResponse = await fetch(serverInfoUrl.toString());
        if (serverResponse.ok) {
          await serverResponse.json();
          logDebug('HTTP polling: BlueBubbles API accessible');
        } else if (serverResponse.status === 401) {
          logError('BlueBubbles API authentication failed - disabling HTTP polling');
          this.blueBubblesPollingDisabled = true;
        } else {
          logDebug('HTTP polling: BlueBubbles API returned non-OK status', { status: serverResponse.status });
        }
      } catch (error) {
        if ((error as Error)?.message?.includes('401')) {
          logError('BlueBubbles API authentication failed - disabling HTTP polling', error);
          this.blueBubblesPollingDisabled = true;
          return;
        }
        logDebug('HTTP polling: Network error', { error: (error as Error).message });
      }
    }, 30000); // Check every 30 seconds

    logInfo('HTTP polling started - checking server availability every 30 seconds');
  }

  async handleIncomingMessage(bbMessage: BlueBubblesMessage): Promise<void> {
    let user: User | null = null;
    let conversation: Conversation | null = null;
    let chatGuid: string | null = null;
    let typingStarted = false;
    let typingGuid: string | null = null;

    try {
      // STARTUP PROTECTION: Skip messages received during grace period to prevent backlog processing
      if (this.startupProtectionEnabled) {
        const timeSinceStartup = Date.now() - this.startupTime;
        logInfo('Ignoring message during startup protection period', {
          guid: bbMessage.guid,
          timeSinceStartupMs: timeSinceStartup,
          gracePeriodMs: this.startupGracePeriodMs,
          textPreview: bbMessage.text?.substring(0, 30)
        });
        return;
      }

      logInfo('Processing incoming message', {
        guid: bbMessage.guid,
        chat: bbMessage.chat_id,
        text: bbMessage.text?.substring(0, 50),
        isFromMe: bbMessage.is_from_me
      });

      // Skip if message is from the AI (sent by us)
      if (bbMessage.is_from_me) {
        logInfo('Skipping self-sent message (is_from_me=true)', {
          guid: bbMessage.guid,
          textPreview: bbMessage.text?.substring(0, 50)
        });
        return;
      }

      // STALE MESSAGE CHECK: Skip messages older than 5 minutes (catches messages that bypass debounce)
      if (this.isMessageTooOld(bbMessage, 300_000)) {
        logInfo('Skipping stale message in handleIncomingMessage', {
          guid: bbMessage.guid,
          textPreview: bbMessage.text?.substring(0, 50)
        });
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

      // GLOBAL ECHO CHECK: Catch our own messages before conversation is resolved
      if (this.isGlobalOutboundEcho(bbMessage.text)) {
        logInfo('Skipping message - matches recent outbound (global echo detection)', {
          guid: bbMessage.guid,
          textPreview: bbMessage.text?.substring(0, 50)
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
          logInfo('Starting typing indicator', { 
            typingGuid, 
            messageGuid: bbMessage.guid,
            textPreview: bbMessage.text?.substring(0, 30)
          });
          await this.blueBubblesClient.startTypingIndicator(typingGuid);
          typingStarted = true;
        }
      }

      if (this.isRecentAssistantEcho(conversation.id, bbMessage, processedMessage.text)) {
        logDebug('Skipping assistant echo detected via outbound cache', {
          guid: bbMessage.guid,
          conversationId: conversation.id
        });
        // Stop typing indicator before early return
        if (typingStarted && typingGuid) {
          await this.blueBubblesClient.stopTypingIndicator(typingGuid);
        }
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
      // Reduced from 35 to 15 to avoid including old corrupted data
      const rawConversationHistory = await this.getConversationHistory(conversation.id, 15);
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

      // Use dual-agent system if enabled, otherwise use direct Claude service
      if (this.dualAgentEnabled) {
        // Check rate limit before processing dual-agent response
        if (this.isResponseRateLimited(conversation.id)) {
          logWarn('Skipping dual-agent response due to rate limit - possible loop detected', {
            conversationId: conversation.id
          });
          // Stop typing indicator before early return
          if (typingStarted && typingGuid) {
            await this.blueBubblesClient.stopTypingIndicator(typingGuid);
          }
          return;
        }
        
        chatGuid = await this.resolveChatGuid(conversation, bbMessage, user);
        
        if (!chatGuid) {
          logError('No chat GUID available for dual-agent response', {
            conversationId: conversation.id
          });
        } else {
          // Process via interaction agent (handles its own message sending)
          // Only pass message GUID if it's from the user (is_from_me=false)
          // This prevents the agent from reacting to its own messages
          const safeMessageGuid = bbMessage.is_from_me ? '' : (bbMessage.guid || '');
          const safeMessageText = bbMessage.is_from_me ? '' : (bbMessage.text || '');
          
          const interactionRuntime = createInteractionAgentRuntime(
            conversation.id,
            user.id,
            chatGuid,
            toolContext,
            conversationHistory,
            safeMessageGuid,  // Pass message GUID for reaction support (empty if from agent)
            safeMessageText   // Pass message text for debugging reaction targets
          );

          const result = await interactionRuntime.processUserMessage(processedMessage.text || '');
          
          logInfo('Dual-agent processing completed', {
            conversationId: conversation.id,
            success: result.success,
            messagesSent: result.messagesSent.length,
            agentsSpawned: result.agentsSpawned.length
          });

          // Save assistant messages to database
          // Strip || separators and replace with newlines for cleaner history
          for (const msg of result.messagesSent) {
            const cleanedMsg = msg.replace(/\s*\|\|\s*/g, '\n').trim();
            await this.saveMessage(user.id, conversation.id, 'assistant', cleanedMsg, {
              source: 'dual-agent',
              agentsSpawned: result.agentsSpawned
            } as MessageMetadata);
            // Record EACH bubble separately for echo detection (iMessageAdapter splits on ||)
            const bubbles = msg.split(/\s*\|\|\s*/).map(b => b.trim()).filter(b => b.length > 0);
            for (const bubble of bubbles) {
              this.recordOutboundMessage(conversation.id, bubble);
            }
          }
        }

        if (typingStarted && typingGuid) {
          logInfo('Stopping typing indicator after dual-agent', { typingGuid, typingStarted });
          await this.blueBubblesClient.stopTypingIndicator(typingGuid);
          logInfo('Typing indicator stopped after dual-agent', { typingGuid });
          typingStarted = false;
          typingGuid = null;
        } else {
          logInfo('Skipping stopTypingIndicator - not started or no guid', { typingStarted, typingGuid });
        }
        return;
      }

      // Get AI response with tools and multi-modal support (legacy path)
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

        // Check rate limit before sending response
        if (sendEnabled && this.isResponseRateLimited(conversation.id)) {
          logWarn('Skipping response due to rate limit - possible loop detected', {
            conversationId: conversation.id
          });
          // Stop typing indicator before early return
          if (typingStarted && typingGuid) {
            await this.blueBubblesClient.stopTypingIndicator(typingGuid);
          }
          return;
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
          logDebug('Typing indicator stopped (cleanup)', { typingGuid });
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
    // Split on EITHER || delimiter OR double newlines (paragraph breaks)
    // This ensures messages get split regardless of whether Claude uses || or \n\n
    const delimiterPattern = /\s*\|\|\s*|\n\n+/;
    const maxCharPerBubble = 500; // Allow longer messages for informational content
    
    const parts = content
      .split(delimiterPattern)
      .map(part => part.trim())
      .filter(part => part.length > 0);

    if (parts.length === 0) {
      return [this.truncateBubble(content.trim(), maxCharPerBubble)];
    }

    const maxBurst = Math.max(1, config.messaging.maxResponseBurst || 3);
    
    // Truncate each bubble to max length
    const truncatedParts = parts.map(part => this.truncateBubble(part, maxCharPerBubble));
    
    if (truncatedParts.length <= maxBurst) {
      return truncatedParts;
    }

    const limited = truncatedParts.slice(0, maxBurst - 1);
    const remainder = truncatedParts.slice(maxBurst - 1).join(' ');
    limited.push(this.truncateBubble(remainder.trim(), maxCharPerBubble));
    return limited.filter(part => part.length > 0);
  }
  
  private truncateBubble(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    // Truncate at word boundary and add ellipsis
    const truncated = text.substring(0, maxLength - 3);
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > maxLength * 0.7) {
      return truncated.substring(0, lastSpace) + '...';
    }
    return truncated + '...';
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

    // ALWAYS record outbound messages globally to prevent echo processing
    const normalized = this.normalizeMessageText(text);
    if (normalized) {
      this.globalOutboundCache.set(normalized, Date.now());
      logDebug('Recorded outbound message in global cache', {
        textPreview: normalized.substring(0, 50),
        chatGuid,
        conversationId
      });
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
      logDebug('Conversation history within token limit, no summarization needed', {
        inputTokens,
        summaryTrigger
      });
      return history;
    }

    logInfo('Conversation history exceeds token threshold, triggering summarization', {
      inputTokens,
      summaryTrigger,
      historyLength: history.length
    });

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
      // Extract identifier from the message handle (can be phone number OR email)
      const handleAddress = bbMessage.handle?.address;
      if (!handleAddress) {
        logError('No handle address found in message', { handle: bbMessage.handle });
        return null;
      }

      // Determine if this is an email or phone number
      const isEmail = handleAddress.includes('@');
      
      logDebug('Extracted handle address from message', { 
        handleAddress, 
        isEmail 
      });

      // Check if user exists by email or phone number
      let user: User | null = null;
      
      if (isEmail) {
        user = await this.userRepo.findOne({
          where: { email: handleAddress }
        });
      } else {
        user = await this.userRepo.findOne({
          where: { phoneNumber: handleAddress }
        });
      }

      // Create user if doesn't exist
      if (!user) {
        const userData: Partial<User> = {
          preferences: {
            aiPersonality: 'friendly',
            enableReminders: true,
            reminderChannelPreference: 'imessage'
          } as any
        };
        
        if (isEmail) {
          userData.email = handleAddress;
        } else {
          userData.phoneNumber = handleAddress;
        }
        
        user = this.userRepo.create(userData);
        user = await this.userRepo.save(user);
        
        logInfo('Created new user', { 
          id: user.id, 
          email: isEmail ? handleAddress : undefined,
          phoneNumber: isEmail ? undefined : handleAddress 
        });
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
    // Check for duplicate content within recent messages (prevent saving same message twice)
    const recentDuplicate = await this.messageRepo.findOne({
      where: {
        conversationId,
        role,
        content
      },
      order: { createdAt: 'DESC' }
    });
    
    if (recentDuplicate) {
      const ageMs = Date.now() - recentDuplicate.createdAt.getTime();
      // If identical message exists within last 5 minutes, skip saving
      if (ageMs < 5 * 60_000) {
        logInfo('Skipping duplicate message save', {
          role,
          conversationId,
          contentPreview: content.substring(0, 50),
          existingMessageId: recentDuplicate.id,
          ageMs
        });
        return recentDuplicate;
      }
    }
    
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

    // Append to working memory for summarization
    void this.appendToWorkingMemory(userId, conversationId, role, content);
    
    return savedMessage;
  }

  private async getConversationHistory(conversationId: string, limit: number = 20): Promise<Array<{role: string; content: string}>> {
    // Fetch more than needed so we can filter out corrupted messages
    const messages = await this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'DESC' }, // Get most recent first
      take: limit * 3 // Fetch extra to account for filtered and deduplicated messages
    });

    // Filter out corrupted/problematic messages
    const validMessages = messages.filter(msg => this.isValidHistoryMessage(msg));
    
    // Deduplicate by content - keep only the most recent occurrence of each unique content
    const seenContent = new Set<string>();
    const deduplicated = validMessages.filter(msg => {
      const normalized = msg.content.trim().toLowerCase();
      if (seenContent.has(normalized)) {
        logDebug('Removing duplicate message from history', {
          conversationId,
          role: msg.role,
          contentPreview: msg.content.substring(0, 50)
        });
        return false;
      }
      seenContent.add(normalized);
      return true;
    });
    
    // Take only what we need and restore chronological order
    const limited = deduplicated.slice(0, limit).reverse();

    return limited.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  }
  
  /**
   * Filter out corrupted or problematic messages from history
   */
  private isValidHistoryMessage(msg: { role: string; content: string }): boolean {
    const content = msg.content?.trim() || '';
    
    // Skip empty messages
    if (content.length === 0) return false;
    
    // Skip error messages that got saved incorrectly
    const errorPatterns = [
      "I'm having trouble processing your message",
      "Please try again later",
      "sorry, you reached the message limit",
      "upgrade to continue chatting"
    ];
    if (errorPatterns.some(pattern => content.toLowerCase().includes(pattern.toLowerCase()))) {
      return false;
    }
    
    // Skip messages that are just URLs (likely spam or errors)
    if (/^https?:\/\/\S+$/.test(content)) return false;
    
    // Skip extremely long messages (likely email drafts saved incorrectly)
    if (content.length > 2000) return false;
    
    return true;
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
