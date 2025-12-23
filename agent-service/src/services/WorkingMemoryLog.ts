import { Repository } from 'typeorm';
import { AppDataSource } from '../database/connection';
import { WorkingMemoryState } from '../database/entities/WorkingMemoryState';
import { logInfo, logError, logDebug } from '../utils/logger';

/**
 * Entry in the working memory log.
 */
export interface WorkingMemoryEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

/**
 * WorkingMemoryLog maintains an append-only log of conversation entries
 * with automatic summarization when the log exceeds a threshold.
 */
export class WorkingMemoryLog {
  private stateRepo: Repository<WorkingMemoryState>;
  private entries: WorkingMemoryEntry[] = [];
  private userId: string;
  private conversationId: string | undefined;
  private summaryText: string | null = null;
  private lastEntryIndex: number = -1;
  private summarizationThreshold: number;

  constructor(
    userId: string,
    conversationId?: string,
    summarizationThreshold = 20
  ) {
    this.stateRepo = AppDataSource.getRepository(WorkingMemoryState);
    this.userId = userId;
    this.conversationId = conversationId;
    this.summarizationThreshold = summarizationThreshold;
  }

  /**
   * Load existing state from database.
   */
  async load(): Promise<void> {
    try {
      const state = await this.stateRepo.findOne({
        where: {
          userId: this.userId,
          conversationId: this.conversationId ?? undefined
        }
      });

      if (state) {
        this.summaryText = state.summaryText ?? null;
        this.lastEntryIndex = state.lastEntryIndex;
        logDebug('WorkingMemoryLog loaded state', {
          userId: this.userId,
          hasSummary: !!this.summaryText,
          lastEntryIndex: this.lastEntryIndex
        });
      }
    } catch (error) {
      logError('Failed to load working memory state', error);
    }
  }

  /**
   * Append a new entry to the log.
   */
  append(entry: WorkingMemoryEntry): void {
    this.entries.push(entry);
    this.lastEntryIndex++;
    
    logDebug('WorkingMemoryLog appended entry', {
      role: entry.role,
      entryCount: this.entries.length
    });
  }

  /**
   * Check if summarization is needed based on threshold.
   */
  needsSummarization(): boolean {
    return this.entries.length >= this.summarizationThreshold;
  }

  /**
   * Get entries that need to be summarized (older entries).
   * Keeps the most recent entries for context.
   */
  getEntriesForSummarization(keepRecent = 5): WorkingMemoryEntry[] {
    if (this.entries.length <= keepRecent) {
      return [];
    }
    return this.entries.slice(0, this.entries.length - keepRecent);
  }

  /**
   * Apply a summary, replacing older entries.
   */
  applySummary(summary: string, keepRecent = 5): void {
    this.summaryText = summary;
    
    // Keep only recent entries
    if (this.entries.length > keepRecent) {
      this.entries = this.entries.slice(-keepRecent);
    }

    logInfo('WorkingMemoryLog applied summary', {
      summaryLength: summary.length,
      remainingEntries: this.entries.length
    });
  }

  /**
   * Render the working memory for inclusion in prompts.
   */
  render(): string {
    const sections: string[] = [];

    // Add summary if available
    if (this.summaryText) {
      sections.push(`<conversation_summary>\n${this.summaryText}\n</conversation_summary>`);
    }

    // Add recent entries
    if (this.entries.length > 0) {
      const formattedEntries = this.entries.map(entry => {
        const timestamp = entry.timestamp.toISOString();
        return `<${entry.role}_message timestamp="${timestamp}">${entry.content}</${entry.role}_message>`;
      }).join('\n');
      
      sections.push(`<recent_messages>\n${formattedEntries}\n</recent_messages>`);
    }

    return sections.join('\n\n');
  }

  /**
   * Save current state to database.
   */
  async save(): Promise<void> {
    try {
      let state = await this.stateRepo.findOne({
        where: {
          userId: this.userId,
          conversationId: this.conversationId ?? undefined
        }
      });

      if (!state) {
        state = this.stateRepo.create({
          userId: this.userId,
          conversationId: this.conversationId
        });
      }

      state.summaryText = this.summaryText ?? undefined;
      state.lastEntryIndex = this.lastEntryIndex;
      state.entryCount = this.entries.length;

      await this.stateRepo.save(state);

      logDebug('WorkingMemoryLog saved state', {
        userId: this.userId,
        hasSummary: !!this.summaryText
      });
    } catch (error) {
      logError('Failed to save working memory state', error);
    }
  }

  /**
   * Get current summary text.
   */
  getSummary(): string | null {
    return this.summaryText;
  }

  /**
   * Get current entry count.
   */
  getEntryCount(): number {
    return this.entries.length;
  }

  /**
   * Clear all entries and summary.
   */
  clear(): void {
    this.entries = [];
    this.summaryText = null;
    this.lastEntryIndex = -1;
  }
}

/**
 * Factory function to create and load a working memory log.
 */
export async function createWorkingMemoryLog(
  userId: string,
  conversationId?: string,
  summarizationThreshold = 20
): Promise<WorkingMemoryLog> {
  const log = new WorkingMemoryLog(userId, conversationId, summarizationThreshold);
  await log.load();
  return log;
}
