import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { logInfo, logError, logDebug, logWarn } from '../utils/logger';
import { ServiceResponse } from '../types';
import { config } from '../config';
import { ProcessedMessage } from '../handlers/MessageHandler';
import { getToolRegistry } from '../tools/ToolRegistry';
import { ToolExecutionContext } from '../tools/Tool';
import { getAnthropicRequestManager } from './AnthropicRequestManager';

// Load Grace system prompt from markdown file
const GRACE_PROMPT_PATH = join(__dirname, '../agents/prompts/grace_system_prompt.md');
let GRACE_SYSTEM_PROMPT: string;
try {
  GRACE_SYSTEM_PROMPT = readFileSync(GRACE_PROMPT_PATH, 'utf-8');
  logInfo('Loaded Grace system prompt from file', { path: GRACE_PROMPT_PATH });
} catch (error) {
  logWarn('Failed to load Grace system prompt from file, using fallback', { error });
  GRACE_SYSTEM_PROMPT = '';
}

const MODEL_ALIAS_MAP: Record<string, string> = {
  'claude-3-5-sonnet-latest': 'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-latest': 'claude-3-5-haiku-20241022',
  'claude-3-opus-latest': 'claude-3-opus-20240229'
};

const DEFAULT_MODEL = 'claude-3-5-haiku-20241022';

export interface EnhancedClaudeResponse {
  content: string;
  tokensUsed: number;
  finishReason: string;
  toolsUsed?: string[];
  metadata?: any;
}

/**
 * Enhanced Claude Service with tool calling and vision support
 */
export class ClaudeServiceEnhanced {
  private anthropic: Anthropic;
  private model: string;
  private configuredModel: string;
  private responseMaxTokens: number;
  private temperature: number;
  private toolRegistry = getToolRegistry();
  private requestManager = getAnthropicRequestManager();
  private maxRetries = 3;
  private baseRetryDelayMs = 1000;
  private loggedWebSearchUnsupported = false;
  private loggedWebFetchUnsupported = false;
  
  constructor() {
    this.configuredModel = config.anthropic.model || DEFAULT_MODEL;
    this.model = this.resolveModelAlias(this.configuredModel);

    const defaultHeaders: Record<string, string> = {};
    if (config.anthropic.enableWebFetch && this.supportsWebFetch()) {
      defaultHeaders['anthropic-beta'] = config.anthropic.webFetchBetaHeader || 'web-fetch-2025-09-10';
    }

    this.anthropic = new Anthropic({
      apiKey: config.anthropic.apiKey,
      defaultHeaders: Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined
    });
    this.responseMaxTokens = config.anthropic.responseMaxTokens
      || config.anthropic.maxTokens
      || 600;
    this.temperature = config.anthropic.temperature || 0.7;
  }

  private resolveModelAlias(model: string): string {
    const normalized = model.trim().toLowerCase();
    const resolved = MODEL_ALIAS_MAP[normalized];

    if (resolved && resolved !== model) {
      logWarn('Configured Anthropic model alias resolved to supported version', {
        requested: model,
        resolved
      });
      return resolved;
    }

    if (normalized.endsWith('-latest') && !resolved) {
      logWarn('Anthropic model alias not directly mapped; falling back to default model', {
        requested: model,
        fallback: DEFAULT_MODEL
      });
      return DEFAULT_MODEL;
    }

    return model || DEFAULT_MODEL;
  }

  /**
   * Send message with tool calling and vision support
   */
  async sendMessage(
    processedMessages: ProcessedMessage[],
    conversationHistory: Array<{role: string; content: string}>,
    toolContext: ToolExecutionContext,
    systemPrompt?: string,
    allowFallback = true
  ): Promise<ServiceResponse<EnhancedClaudeResponse>> {
    try {
      const activeModel = this.model;
      logDebug('Sending enhanced message to Claude', { 
        messageCount: processedMessages.length,
        model: activeModel,
        configuredModel: this.configuredModel
      });

      // Build messages with multi-modal content
      const messages = this.buildMessages(processedMessages, conversationHistory);
      
      // Get tool definitions (client tools)
      const toolDefinitions = this.toolRegistry.getToolDefinitions();
      const serverTools = this.buildServerToolDefinitions();
      const combinedTools = [...toolDefinitions, ...serverTools];
      const toolsPayload = combinedTools.length > 0 ? (combinedTools as any) : undefined;

      const basePrompt = systemPrompt || this.buildAgentGracePrompt();
      const finalSystemPrompt = this.buildDynamicSystemPrompt(basePrompt, toolContext.runtimeContext);
      
      logInfo('Tools available for Claude', {
        toolCount: combinedTools.length,
        toolNames: combinedTools.map(t => t.name)
      });
      
      logInfo('System prompt preview', {
        promptStart: finalSystemPrompt.substring(0, 200)
      });

      // Create Claude API request
      let response = await this.performAnthropicRequest(() => this.anthropic.messages.create({
        model: activeModel,
        max_tokens: this.responseMaxTokens,
        temperature: this.temperature,
        system: finalSystemPrompt,
        messages,
        tools: toolsPayload
      }), {
        description: 'claude-sendMessage',
        estimatedInputTokens: this.estimateInputTokens(messages),
        estimatedOutputTokens: this.responseMaxTokens
      });

      const toolsUsed: string[] = [];

      // Handle tool use loop
      while (response.stop_reason === 'tool_use') {
        const toolUseBlocks = (response.content as any[]).filter(block => block.type === 'tool_use');
        
        const toolResults = [];
        for (const toolUse of toolUseBlocks as Array<any>) {
          logInfo('Tool requested by Claude', { toolName: toolUse.name });
          toolsUsed.push(toolUse.name);
          
          const result = await this.toolRegistry.executeTool(
            toolUse.name,
            toolUse.input,
            toolContext
          );

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result.success ? result.data : { error: result.error })
          });
        }

        // Continue conversation with tool results
        messages.push({
          role: 'assistant',
          content: response.content
        });

        messages.push({
          role: 'user',
          content: toolResults
        });

        response = await this.performAnthropicRequest(() => this.anthropic.messages.create({
          model: activeModel,
          max_tokens: this.responseMaxTokens,
          temperature: this.temperature,
          system: systemPrompt || this.buildAgentGracePrompt(),
          messages,
          tools: toolsPayload
        }), {
          description: 'claude-tool-followup',
          estimatedInputTokens: this.estimateInputTokens(messages),
          estimatedOutputTokens: this.responseMaxTokens
        });
      }

      // Extract final text response
      const textContent = (response.content as any[])
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n');

      const result: EnhancedClaudeResponse = {
        content: textContent,
        tokensUsed: response.usage?.output_tokens || 0,
        finishReason: response.stop_reason || 'stop',
        toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
        metadata: {
          model: response.model,
          id: response.id,
          usage: response.usage
        }
      };

      logInfo('Claude response received', {
        tokensUsed: result.tokensUsed,
        finishReason: result.finishReason,
        toolsUsed: toolsUsed.length
      });

      return {
        success: true,
        data: result
      };
    } catch (error: any) {
      if (allowFallback && this.shouldFallbackModel(error)) {
        logWarn('Anthropic model unavailable; falling back to default model', {
          requestedModel: this.model,
          fallbackModel: DEFAULT_MODEL,
          error: error.message
        });
        this.model = DEFAULT_MODEL;
        return this.sendMessage(processedMessages, conversationHistory, toolContext, systemPrompt, false);
      }

      logError('Failed to get Claude response', { 
        error: error.message,
        errorType: error.constructor.name,
        errorDetails: error.error || error,
        stack: error.stack
      });
      return {
        success: false,
        error: error.message || 'Failed to get response from Claude'
      };
    }
  }

  /**
   * Build messages with multi-modal content
   * Ensures messages alternate between user and assistant roles as required by Claude API
   */
  private buildMessages(
    processedMessages: ProcessedMessage[],
    conversationHistory: Array<{role: string; content: string}>
  ): any[] {
    const messages: any[] = [];

    // Add conversation history
    for (const msg of conversationHistory) {
      messages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      });
    }

    // Add current processed messages with multi-modal content
    for (const processed of processedMessages) {
      const content: any[] = [];

      // Add images first
      if (processed.images && processed.images.length > 0) {
        for (const image of processed.images) {
          content.push({
            type: 'image',
            source: {
              type: image.type,
              media_type: image.mediaType,
              [image.type === 'base64' ? 'data' : 'url']: image.data
            }
          });
        }
      }

      // Add text
      if (processed.text) {
        content.push({
          type: 'text',
          text: processed.text
        });
      }

      // Add audio transcription if available
      if (processed.audio?.transcription) {
        content.push({
          type: 'text',
          text: `[Audio message transcription]: ${processed.audio.transcription}`
        });
      }

      if (content.length > 0) {
        messages.push({
          role: 'user',
          content: content.length === 1 && content[0].type === 'text' 
            ? content[0].text 
            : content
        });
      }
    }

    // Validate and fix message alternation
    // Claude API requires messages to alternate between user and assistant
    const validatedMessages: any[] = [];
    let lastRole: string | null = null;

    for (const msg of messages) {
      if (msg.role === lastRole) {
        // Merge consecutive messages from the same role
        if (validatedMessages.length > 0) {
          const lastMsg = validatedMessages[validatedMessages.length - 1];
          // Merge content
          if (typeof lastMsg.content === 'string' && typeof msg.content === 'string') {
            lastMsg.content = lastMsg.content + '\n\n' + msg.content;
          } else {
            // For complex content, just append
            lastMsg.content = Array.isArray(lastMsg.content) ? lastMsg.content : [{ type: 'text', text: lastMsg.content }];
            const newContent = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content }];
            lastMsg.content = [...lastMsg.content, ...newContent];
          }
        }
      } else {
        validatedMessages.push(msg);
        lastRole = msg.role;
      }
    }

    // Ensure first message is from user
    if (validatedMessages.length > 0 && validatedMessages[0].role !== 'user') {
      validatedMessages.unshift({
        role: 'user',
        content: '[Previous conversation context]'
      });
    }

    return validatedMessages;
  }

  private async performAnthropicRequest<T>(
    requestFactory: () => Promise<T>,
    options: {
      description: string;
      estimatedInputTokens: number;
      estimatedOutputTokens: number;
      priority?: number;
      tags?: string[];
    }
  ): Promise<T> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt < this.maxRetries) {
      try {
        return await this.requestManager.execute(
          () => requestFactory(),
          {
            priority: options.priority,
            estimatedInputTokens: options.estimatedInputTokens,
            estimatedOutputTokens: options.estimatedOutputTokens,
            description: options.description,
            tags: options.tags
          }
        );
      } catch (error: any) {
        lastError = error;
        attempt += 1;

        const retryInfo = this.getRetryInfo(error);
        if (!retryInfo.shouldRetry || attempt >= this.maxRetries) {
          throw error;
        }

        logWarn('Claude request rate limited, retrying', {
          description: options.description,
          attempt,
          delayMs: retryInfo.delayMs
        });

        await this.sleep(retryInfo.delayMs);
      }
    }

    throw lastError;
  }

  private estimateInputTokens(messages: Array<{ content: any }>): number {
    const averageTokensPerChar = 0.25;
    const totalCharacters = messages.reduce((sum, message) => {
      if (typeof message.content === 'string') {
        return sum + message.content.length;
      }

      if (Array.isArray(message.content)) {
        return sum + message.content.reduce((innerSum: number, block: any) => {
          if (block?.type === 'text' && typeof block.text === 'string') {
            return innerSum + block.text.length;
          }
          return innerSum;
        }, 0);
      }

      return sum;
    }, 0);

    return Math.ceil(totalCharacters * averageTokensPerChar);
  }

  private buildServerToolDefinitions(): Array<{ type: string; name: string; max_uses?: number }> {
    const tools: Array<{ type: string; name: string; max_uses?: number }> = [];

    if (config.anthropic.enableWebSearch) {
      if (this.supportsWebSearch()) {
        tools.push({
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: config.anthropic.webSearchMaxUses ?? 5
        });
      } else if (!this.loggedWebSearchUnsupported) {
        logWarn('Configured for web search, but current model does not support Anthropic web_search tool', {
          model: this.model
        });
        this.loggedWebSearchUnsupported = true;
      }
    }

    if (config.anthropic.enableWebFetch) {
      if (this.supportsWebFetch()) {
        tools.push({
          type: 'web_fetch_20250910',
          name: 'web_fetch',
          max_uses: config.anthropic.webFetchMaxUses ?? 3
        });
      } else if (!this.loggedWebFetchUnsupported) {
        logWarn('Configured for web fetch, but current model does not support Anthropic web_fetch tool', {
          model: this.model
        });
        this.loggedWebFetchUnsupported = true;
      }
    }

    return tools;
  }

  private shouldFallbackModel(error: any): boolean {
    if (!error) {
      return false;
    }

    const message = typeof error === 'string' ? error : error.message || error?.error?.message;
    const type = error?.error?.type || error?.errorType;

    return (
      this.model !== DEFAULT_MODEL &&
      typeof message === 'string' && message.includes('model:') && message.includes('not_found_error')
    ) || type === 'NotFoundError';
  }

  private supportsWebSearch(): boolean {
    const patterns = [
      'claude-3-5-haiku',
      'claude-haiku-4-5',
      'claude-sonnet-4-5',
      'claude-sonnet-4',
      'claude-3-7-sonnet',
      'claude-opus-4-1',
      'claude-opus-4'
    ];
    return patterns.some(pattern => this.model.includes(pattern));
  }

  private supportsWebFetch(): boolean {
    const patterns = [
      'claude-3-5-haiku',
      'claude-haiku-4-5',
      'claude-sonnet-4-5',
      'claude-sonnet-4',
      'claude-3-7-sonnet',
      'claude-opus-4-1',
      'claude-opus-4'
    ];
    return patterns.some(pattern => this.model.includes(pattern));
  }

  private getRetryInfo(error: any): { shouldRetry: boolean; delayMs: number } {
    const isRateLimit = error?.status === 429
      || error?.error?.type === 'rate_limit_error'
      || typeof error?.message === 'string' && error.message.includes('rate_limit');

    if (!isRateLimit) {
      return { shouldRetry: false, delayMs: 0 };
    }

    const retryAfterHeader = error?.response?.headers?.['retry-after']
      || error?.headers?.['retry-after']
      || error?.response?.headers?.get?.('retry-after');

    let retryAfterMs = this.baseRetryDelayMs;
    if (retryAfterHeader) {
      const retryAfterSeconds = parseFloat(retryAfterHeader);
      if (!Number.isNaN(retryAfterSeconds) && retryAfterSeconds > 0) {
        retryAfterMs = retryAfterSeconds * 1000;
      }
    }

    return {
      shouldRetry: true,
      delayMs: retryAfterMs
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Build dynamic system prompt by appending runtime context to static prompt.
   */
  private buildDynamicSystemPrompt(
    staticPrompt: string,
    runtimeContext?: any
  ): string {
    if (!runtimeContext) {
      return staticPrompt;
    }

    const contextSections: string[] = [];

    // Current datetime
    if (runtimeContext.currentDatetime) {
      contextSections.push(`**Current DateTime**: ${runtimeContext.currentDatetime}`);
    }

    // User profile
    if (runtimeContext.userProfile) {
      const profile = Object.entries(runtimeContext.userProfile)
        .filter(([_, v]) => v)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join('\n');
      if (profile) {
        contextSections.push(`**User Profile**:\n${profile}`);
      }
    }

    // User preferences
    if (runtimeContext.userPreferences?.length) {
      contextSections.push(`**User Preferences**:\n${runtimeContext.userPreferences.map((p: string) => `- ${p}`).join('\n')}`);
    }

    // Memory highlights
    if (runtimeContext.memoryHighlights?.length) {
      contextSections.push(`**Memory Highlights**:\n${runtimeContext.memoryHighlights.map((m: string) => `- ${m}`).join('\n')}`);
    }

    // Conversation summary
    if (runtimeContext.conversationSummary) {
      contextSections.push(`**Conversation Summary**:\n${runtimeContext.conversationSummary}`);
    }

    // Active tasks
    if (runtimeContext.activeTasks?.length) {
      contextSections.push(`**Active Tasks**:\n${runtimeContext.activeTasks.map((t: string) => `- ${t}`).join('\n')}`);
    }

    // Active reminders
    if (runtimeContext.activeReminders?.length) {
      contextSections.push(`**Active Reminders**:\n${runtimeContext.activeReminders.map((r: string) => `- ${r}`).join('\n')}`);
    }

    if (contextSections.length === 0) {
      return staticPrompt;
    }

    return `${staticPrompt}\n\n---\n\n## CURRENT SESSION CONTEXT\n\n${contextSections.join('\n\n')}`;
  }

  /**
   * Agent Grace system prompt - loaded from external markdown file
   */
  private buildAgentGracePrompt(): string {
    if (GRACE_SYSTEM_PROMPT) {
      return GRACE_SYSTEM_PROMPT;
    }

    // Fallback prompt if file loading failed - matches grace_system_prompt.md tone
    return `You are Grace, an executive assistant for Weldon Makori, CEO of EverJust.

Core voice:
- Text like a smart friend, not a corporate assistant.
- Default to under 100 characters. Only go long when delivering info they asked for.
- Mirror the user's energy. Lowercase is fine. No over-apologizing or fluff.

Message format:
- Keep it short - think text message, not email.
- Use || on its own line to split into separate bubbles (max 3).
- No emojis unless the user uses them first.

Rules:
- Match your response length to the user's message length.
- If user sends multiple messages, read them as one thought and respond once.
- Use tools when needed but keep responses simple.`;
  }
}

// Singleton instance
let enhancedClaudeServiceInstance: ClaudeServiceEnhanced | null = null;

export const getEnhancedClaudeService = (): ClaudeServiceEnhanced => {
  if (!enhancedClaudeServiceInstance) {
    enhancedClaudeServiceInstance = new ClaudeServiceEnhanced();
  }
  return enhancedClaudeServiceInstance;
};

export default ClaudeServiceEnhanced;
