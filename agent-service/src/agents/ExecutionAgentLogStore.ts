import { Repository } from 'typeorm';
import { AppDataSource } from '../database/connection';
import { ExecutionAgentLog } from '../database/entities/ExecutionAgentLog';
import { ExecutionHistoryEntry } from './ExecutionAgent';
import { logInfo, logError, logDebug } from '../utils/logger';

/**
 * ExecutionAgentLogStore provides persistent storage for execution agent history.
 * This allows agents to maintain context across sessions.
 */
export class ExecutionAgentLogStore {
  private logRepo: Repository<ExecutionAgentLog>;

  constructor() {
    this.logRepo = AppDataSource.getRepository(ExecutionAgentLog);
  }

  /**
   * Save an execution history entry to the database.
   */
  async saveEntry(agentName: string, entry: ExecutionHistoryEntry): Promise<void> {
    try {
      const log = this.logRepo.create({
        agentName,
        entryType: entry.entryType,
        content: entry.content,
        metadata: entry.metadata || {}
      });

      await this.logRepo.save(log);

      logDebug('Saved execution agent log entry', {
        agentName,
        entryType: entry.entryType
      });
    } catch (error) {
      logError('Failed to save execution agent log entry', error);
    }
  }

  /**
   * Load execution history for an agent.
   * Returns the most recent entries up to the limit.
   */
  async loadHistory(agentName: string, limit = 50): Promise<ExecutionHistoryEntry[]> {
    try {
      const logs = await this.logRepo.find({
        where: { agentName },
        order: { createdAt: 'DESC' },
        take: limit
      });

      // Reverse to get chronological order
      const entries = logs.reverse().map(log => ({
        entryType: log.entryType as ExecutionHistoryEntry['entryType'],
        content: log.content,
        timestamp: log.createdAt,
        metadata: log.metadata
      }));

      logDebug('Loaded execution agent history', {
        agentName,
        entryCount: entries.length
      });

      return entries;
    } catch (error) {
      logError('Failed to load execution agent history', error);
      return [];
    }
  }

  /**
   * Get all unique agent names that have logs.
   */
  async getAgentNames(): Promise<string[]> {
    try {
      const result = await this.logRepo
        .createQueryBuilder('log')
        .select('DISTINCT log.agent_name', 'agentName')
        .getRawMany();

      return result.map(r => r.agentName);
    } catch (error) {
      logError('Failed to get agent names', error);
      return [];
    }
  }

  /**
   * Clear history for a specific agent.
   */
  async clearHistory(agentName: string): Promise<void> {
    try {
      await this.logRepo.delete({ agentName });
      logInfo('Cleared execution agent history', { agentName });
    } catch (error) {
      logError('Failed to clear execution agent history', error);
    }
  }

  /**
   * Prune old entries to prevent unbounded growth.
   * Keeps only the most recent entries per agent.
   */
  async pruneOldEntries(maxEntriesPerAgent = 100): Promise<void> {
    try {
      const agentNames = await this.getAgentNames();

      for (const agentName of agentNames) {
        const count = await this.logRepo.count({ where: { agentName } });

        if (count > maxEntriesPerAgent) {
          // Find the cutoff timestamp by getting entries and skipping
          const entriesToKeep = await this.logRepo.find({
            where: { agentName },
            order: { createdAt: 'DESC' },
            take: maxEntriesPerAgent
          });
          
          const oldestToKeep = entriesToKeep.length > 0 
            ? entriesToKeep[entriesToKeep.length - 1] 
            : null;

          if (oldestToKeep) {
            await this.logRepo
              .createQueryBuilder()
              .delete()
              .where('agent_name = :agentName', { agentName })
              .andWhere('created_at < :cutoff', { cutoff: oldestToKeep.createdAt })
              .execute();

            logDebug('Pruned old execution agent logs', {
              agentName,
              deletedCount: count - maxEntriesPerAgent
            });
          }
        }
      }
    } catch (error) {
      logError('Failed to prune execution agent logs', error);
    }
  }
}

// Singleton instance
let logStoreInstance: ExecutionAgentLogStore | null = null;

export function getExecutionAgentLogStore(): ExecutionAgentLogStore {
  if (!logStoreInstance) {
    logStoreInstance = new ExecutionAgentLogStore();
  }
  return logStoreInstance;
}
