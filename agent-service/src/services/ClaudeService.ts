import Anthropic from '@anthropic-ai/sdk';
import { logInfo, logError, logDebug } from '../utils/logger';
import { ClaudeMessage, ClaudeContext, ClaudeResponse, ServiceResponse } from '../types';
import { config } from '../config';

export class ClaudeService {
  private anthropic: Anthropic;
  private model: string;
  private maxTokens: number;
  private temperature: number;
  
  constructor() {
    this.anthropic = new Anthropic({
      apiKey: config.anthropic.apiKey
    });
    this.model = config.anthropic.model || 'claude-3-opus-20240229';
    this.maxTokens = config.anthropic.maxTokens || 4096;
    this.temperature = config.anthropic.temperature || 0.7;
  }

  async sendMessage(
    messages: ClaudeMessage[],
    systemPrompt?: string,
    options?: Partial<ClaudeContext>
  ): Promise<ServiceResponse<ClaudeResponse>> {
    try {
      logDebug('Sending message to Claude', { 
        messageCount: messages.length,
        model: this.model 
      });

      const response = await this.anthropic.messages.create({
        model: options?.model || this.model,
        max_tokens: options?.maxTokens || this.maxTokens,
        temperature: options?.temperature || this.temperature,
        system: systemPrompt || this.buildSystemPrompt(),
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content
        }))
      });

      const result: ClaudeResponse = {
        content: response.content[0].type === 'text' ? response.content[0].text : '',
        tokensUsed: response.usage?.output_tokens || 0,
        finishReason: response.stop_reason || 'stop',
        metadata: {
          model: response.model,
          id: response.id,
          usage: response.usage
        }
      };

      logInfo('Claude response received', {
        tokensUsed: result.tokensUsed,
        finishReason: result.finishReason
      });

      return {
        success: true,
        data: result
      };
    } catch (error: any) {
      logError('Failed to get Claude response', error);
      return {
        success: false,
        error: error.message || 'Failed to get response from Claude'
      };
    }
  }

  async streamMessage(
    messages: ClaudeMessage[],
    systemPrompt?: string,
    onChunk?: (chunk: string) => void,
    options?: Partial<ClaudeContext>
  ): Promise<ServiceResponse<ClaudeResponse>> {
    try {
      logDebug('Starting Claude stream', {
        messageCount: messages.length,
        model: this.model
      });

      const stream = await this.anthropic.messages.create({
        model: options?.model || this.model,
        max_tokens: options?.maxTokens || this.maxTokens,
        temperature: options?.temperature || this.temperature,
        system: systemPrompt || this.buildSystemPrompt(),
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content
        })),
        stream: true
      });

      let fullContent = '';
      let tokensUsed = 0;
      let finishReason = 'stop';

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          const text = chunk.delta.text;
          fullContent += text;
          if (onChunk) {
            onChunk(text);
          }
        } else if (chunk.type === 'message_delta') {
          tokensUsed = chunk.usage?.output_tokens || tokensUsed;
          finishReason = chunk.delta.stop_reason || finishReason;
        }
      }

      const result: ClaudeResponse = {
        content: fullContent,
        tokensUsed,
        finishReason,
        metadata: {
          model: this.model,
          streamed: true
        }
      };

      logInfo('Claude stream completed', {
        tokensUsed: result.tokensUsed,
        contentLength: fullContent.length
      });

      return {
        success: true,
        data: result
      };
    } catch (error: any) {
      logError('Failed to stream Claude response', error);
      return {
        success: false,
        error: error.message || 'Failed to stream response from Claude'
      };
    }
  }

  async generateEmbedding(text: string): Promise<ServiceResponse<number[]>> {
    try {
      // Note: Claude doesn't provide embeddings directly
      // We'll implement this with an alternative service or return a placeholder
      logDebug('Generating embedding for text', { textLength: text.length });
      
      // For now, return a placeholder embedding
      // In production, integrate with an embedding service like OpenAI or Cohere
      const embedding = new Array(1536).fill(0).map(() => Math.random());
      
      return {
        success: true,
        data: embedding
      };
    } catch (error: any) {
      logError('Failed to generate embedding', error);
      return {
        success: false,
        error: error.message || 'Failed to generate embedding'
      };
    }
  }

  private buildSystemPrompt(): string {
    return `You are a helpful AI assistant integrated with iMessage through BlueBubbles. 
You have access to conversation context and can help users with various tasks.
Be concise but friendly in your responses. 
If asked to set reminders or schedule tasks, acknowledge that you can help with that.
Always maintain context from previous messages in the conversation.
Respond naturally as if you're texting with a friend, but remain professional and helpful.`;
  }

  async summarizeConversation(messages: ClaudeMessage[]): Promise<ServiceResponse<string>> {
    try {
      const summaryPrompt = `Please provide a concise summary of this conversation, highlighting key topics and any action items or decisions made.`;
      
      const response = await this.sendMessage(
        messages,
        summaryPrompt,
        {
          maxTokens: 500,
          temperature: 0.3
        }
      );

      if (response.success && response.data) {
        return {
          success: true,
          data: response.data.content
        };
      }

      return {
        success: false,
        error: response.error || 'Failed to generate summary'
      };
    } catch (error: any) {
      logError('Failed to summarize conversation', error);
      return {
        success: false,
        error: error.message || 'Failed to summarize conversation'
      };
    }
  }

  async extractActionItems(text: string): Promise<ServiceResponse<string[]>> {
    try {
      const extractPrompt = `Extract any action items, reminders, or tasks from the following text. 
Return them as a JSON array of strings. If no action items are found, return an empty array.
Only return the JSON array, no other text.`;

      const response = await this.sendMessage(
        [{ role: 'user', content: text }],
        extractPrompt,
        {
          maxTokens: 500,
          temperature: 0.1
        }
      );

      if (response.success && response.data) {
        try {
          const actionItems = JSON.parse(response.data.content);
          return {
            success: true,
            data: actionItems
          };
        } catch (parseError) {
          logError('Failed to parse action items JSON', parseError);
          return {
            success: true,
            data: []
          };
        }
      }

      return {
        success: false,
        error: response.error || 'Failed to extract action items'
      };
    } catch (error: any) {
      logError('Failed to extract action items', error);
      return {
        success: false,
        error: error.message || 'Failed to extract action items'
      };
    }
  }
}

// Singleton instance
let claudeServiceInstance: ClaudeService | null = null;

export const getClaudeService = (): ClaudeService => {
  if (!claudeServiceInstance) {
    claudeServiceInstance = new ClaudeService();
  }
  return claudeServiceInstance;
};

export default ClaudeService;
