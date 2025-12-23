import Anthropic from '@anthropic-ai/sdk';
import { WorkingMemoryLog, WorkingMemoryEntry } from './WorkingMemoryLog';
import { logInfo, logError, logDebug } from '../utils/logger';
import { config } from '../config';

const SUMMARIZATION_PROMPT = `You are the assistant's memory curator. Your job is to produce a concise working-memory briefing from the conversation entries provided.

Produce a structured summary with these sections (omit empty sections):

## Timeline & Commitments
- YYYY-MM-DD HH:MM — event with participants, status

## Pending & Follow-ups
- Due YYYY-MM-DD — task with owner, status, next step

## Preferences & Profile
- Stable preference or personal detail learned

## Context & Notes
- Strategic insight or important configuration

Keep the summary concise but comprehensive. Focus on actionable information and key context that would help continue the conversation naturally.`;

/**
 * SummarizationService handles threshold-based summarization of working memory.
 */
export class SummarizationService {
  private anthropic: Anthropic;
  private model: string;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: config.anthropic.apiKey
    });
    this.model = config.anthropic.model || 'claude-3-5-haiku-20241022';
  }

  /**
   * Summarize entries from a working memory log.
   */
  async summarizeEntries(entries: WorkingMemoryEntry[]): Promise<string | null> {
    if (entries.length === 0) {
      return null;
    }

    try {
      // Format entries for summarization
      const formattedEntries = entries.map(entry => {
        const timestamp = entry.timestamp.toISOString();
        return `[${timestamp}] ${entry.role.toUpperCase()}: ${entry.content}`;
      }).join('\n\n');

      logDebug('SummarizationService summarizing entries', {
        entryCount: entries.length
      });

      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: SUMMARIZATION_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Please summarize the following conversation entries:\n\n${formattedEntries}`
          }
        ]
      });

      // Extract text from response
      const textBlocks = response.content.filter(
        (block): block is Anthropic.TextBlock => block.type === 'text'
      );
      const summary = textBlocks.map(b => b.text).join('\n');

      logInfo('SummarizationService generated summary', {
        entryCount: entries.length,
        summaryLength: summary.length
      });

      return summary;
    } catch (error) {
      logError('SummarizationService failed to summarize', error);
      return null;
    }
  }

  /**
   * Check and summarize a working memory log if threshold exceeded.
   * Returns true if summarization was performed.
   */
  async checkAndSummarize(
    log: WorkingMemoryLog,
    keepRecent = 5
  ): Promise<boolean> {
    if (!log.needsSummarization()) {
      return false;
    }

    const entriesToSummarize = log.getEntriesForSummarization(keepRecent);
    if (entriesToSummarize.length === 0) {
      return false;
    }

    logInfo('SummarizationService triggering summarization', {
      entriesToSummarize: entriesToSummarize.length,
      keepRecent
    });

    // Get existing summary to include in new summarization
    const existingSummary = log.getSummary();
    let entriesToProcess = entriesToSummarize;

    // If there's an existing summary, include it as context
    if (existingSummary) {
      const summaryEntry: WorkingMemoryEntry = {
        role: 'assistant',
        content: `[Previous Summary]\n${existingSummary}`,
        timestamp: new Date(0) // Earliest timestamp
      };
      entriesToProcess = [summaryEntry, ...entriesToSummarize];
    }

    const summary = await this.summarizeEntries(entriesToProcess);

    if (summary) {
      log.applySummary(summary, keepRecent);
      await log.save();
      return true;
    }

    return false;
  }

  /**
   * Generate a quick summary for a set of messages (one-off, not for working memory).
   */
  async quickSummarize(messages: Array<{ role: string; content: string }>): Promise<string | null> {
    const entries: WorkingMemoryEntry[] = messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
      timestamp: new Date()
    }));

    return this.summarizeEntries(entries);
  }
}

// Singleton instance
let summarizationServiceInstance: SummarizationService | null = null;

export function getSummarizationService(): SummarizationService {
  if (!summarizationServiceInstance) {
    summarizationServiceInstance = new SummarizationService();
  }
  return summarizationServiceInstance;
}
