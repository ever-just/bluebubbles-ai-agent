import Anthropic from '@anthropic-ai/sdk';
import type { Message } from '@anthropic-ai/sdk/resources/messages/messages';
import { config } from '../config';
import { logDebug } from '../utils/logger';
import { getAnthropicRequestManager } from './AnthropicRequestManager';

export type ConversationTurn = {
  role: 'user' | 'assistant';
  content: string;
};

class ConversationSummarizer {
  private readonly anthropic: Anthropic;
  private readonly requestManager = getAnthropicRequestManager();
  private readonly maxSummaryTokens = Math.min(512, config.anthropic.maxTokens || 1024);
  private readonly summarySystemPrompt = 'You are an expert note taker. Summarize the conversation succinctly, capturing key topics, decisions, and action items.';
  private readonly model = config.anthropic.model || 'claude-3-haiku-20240307';

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: config.anthropic.apiKey
    });
  }

  async summarize(turns: ConversationTurn[]): Promise<string> {
    if (turns.length === 0) {
      return '';
    }

    const estimatedTokens = this.estimateTokens(turns);

    logDebug('Generating conversation summary', {
      turnCount: turns.length,
      estimatedTokens
    });

    const response = await this.requestManager.execute<Message>(
      () => this.anthropic.messages.create({
        model: this.model,
        max_tokens: this.maxSummaryTokens,
        temperature: 0.2,
        system: this.summarySystemPrompt,
        messages: turns.map(turn => ({
          role: turn.role,
          content: turn.content
        }))
      }),
      {
        description: 'conversation-summary',
        estimatedInputTokens: estimatedTokens,
        estimatedOutputTokens: this.maxSummaryTokens,
        tags: ['summary']
      }
    );

    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim();

    return text;
  }

  private estimateTokens(turns: ConversationTurn[]): number {
    const totalCharacters = turns.reduce((sum, turn) => sum + (turn.content?.length || 0), 0);
    const averageTokensPerChar = 0.25;
    return Math.ceil(totalCharacters * averageTokensPerChar);
  }
}

let summarizerInstance: ConversationSummarizer | null = null;

export const getConversationSummarizer = (): ConversationSummarizer => {
  if (!summarizerInstance) {
    summarizerInstance = new ConversationSummarizer();
  }

  return summarizerInstance;
};
