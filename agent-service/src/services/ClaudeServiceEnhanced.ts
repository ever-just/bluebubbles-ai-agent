import Anthropic from '@anthropic-ai/sdk';
import { logInfo, logError, logDebug, logWarn } from '../utils/logger';
import { ServiceResponse } from '../types';
import { config } from '../config';
import { ProcessedMessage } from '../handlers/MessageHandler';
import { getToolRegistry } from '../tools/ToolRegistry';
import { ToolExecutionContext } from '../tools/Tool';
import { getAnthropicRequestManager } from './AnthropicRequestManager';

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
  private responseMaxTokens: number;
  private temperature: number;
  private toolRegistry = getToolRegistry();
  private requestManager = getAnthropicRequestManager();
  private maxRetries = 3;
  private baseRetryDelayMs = 1000;
  private loggedWebSearchUnsupported = false;
  private loggedWebFetchUnsupported = false;
  
  constructor() {
    this.model = config.anthropic.model || 'claude-3-5-haiku-latest';

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

  /**
   * Send message with tool calling and vision support
   */
  async sendMessage(
    processedMessages: ProcessedMessage[],
    conversationHistory: Array<{role: string; content: string}>,
    toolContext: ToolExecutionContext,
    systemPrompt?: string
  ): Promise<ServiceResponse<EnhancedClaudeResponse>> {
    try {
      logDebug('Sending enhanced message to Claude', { 
        messageCount: processedMessages.length,
        model: this.model 
      });

      // Build messages with multi-modal content
      const messages = this.buildMessages(processedMessages, conversationHistory);
      
      // Get tool definitions (client tools)
      const toolDefinitions = this.toolRegistry.getToolDefinitions();
      const serverTools = this.buildServerToolDefinitions();
      const combinedTools = [...toolDefinitions, ...serverTools];
      const toolsPayload = combinedTools.length > 0 ? (combinedTools as any) : undefined;

      const finalSystemPrompt = systemPrompt || this.buildAgentGracePrompt();
      
      logInfo('Tools available for Claude', {
        toolCount: combinedTools.length,
        toolNames: combinedTools.map(t => t.name)
      });
      
      logInfo('System prompt preview', {
        promptStart: finalSystemPrompt.substring(0, 200)
      });

      // Create Claude API request
      let response = await this.performAnthropicRequest(() => this.anthropic.messages.create({
        model: this.model,
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
          model: this.model,
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
   * Agent Grace system prompt
   */
  private buildAgentGracePrompt(): string {
    return `You are Grace, an executive assistant for Weldon Makori, CEO of EverJust.

Respond naturally to messages. When someone greets you, greet them back briefly. Answer questions directly and concisely. Use tools when appropriate but don't explain them unless asked.`;
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
