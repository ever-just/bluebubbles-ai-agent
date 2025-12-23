import { Repository, LessThanOrEqual, MoreThan } from 'typeorm';
import { AppDataSource } from '../database/connection';
import { Trigger, TriggerMetadata } from '../database/entities/Trigger';
import { logInfo, logError, logDebug, logWarn } from '../utils/logger';
import { ServiceResponse } from '../types';
import * as chrono from 'chrono-node';

export interface TriggerCreateInput {
  userId: string;
  agentName: string;
  payload: string;
  startTime?: Date;
  recurrenceRule?: string;
  timezone?: string;
}

export interface TriggerUpdateInput {
  payload?: string;
  nextTrigger?: Date;
  recurrenceRule?: string;
  status?: 'active' | 'paused' | 'completed';
  timezone?: string;
}

export class TriggerService {
  private triggerRepo: Repository<Trigger>;

  constructor() {
    this.triggerRepo = AppDataSource.getRepository(Trigger);
  }

  async createTrigger(input: TriggerCreateInput): Promise<ServiceResponse<Trigger>> {
    try {
      const { userId, agentName, payload, startTime, recurrenceRule, timezone = 'America/Chicago' } = input;

      // Calculate next trigger time
      let nextTrigger: Date | undefined;
      if (startTime) {
        nextTrigger = startTime;
      } else if (recurrenceRule) {
        nextTrigger = this.calculateNextTrigger(recurrenceRule, timezone);
      }

      const trigger = this.triggerRepo.create({
        userId,
        agentName,
        payload,
        startTime,
        nextTrigger,
        recurrenceRule,
        timezone,
        status: 'active',
        metadata: {}
      });

      const saved = await this.triggerRepo.save(trigger);

      logInfo('Trigger created', {
        id: saved.id,
        agentName,
        nextTrigger: nextTrigger?.toISOString()
      });

      return { success: true, data: saved };
    } catch (error: any) {
      logError('Failed to create trigger', error);
      return { success: false, error: error.message };
    }
  }

  async updateTrigger(triggerId: number, input: TriggerUpdateInput): Promise<ServiceResponse<Trigger>> {
    try {
      const trigger = await this.triggerRepo.findOne({ where: { id: triggerId } });

      if (!trigger) {
        return { success: false, error: 'Trigger not found' };
      }

      if (input.payload !== undefined) trigger.payload = input.payload;
      if (input.nextTrigger !== undefined) trigger.nextTrigger = input.nextTrigger;
      if (input.recurrenceRule !== undefined) trigger.recurrenceRule = input.recurrenceRule;
      if (input.status !== undefined) trigger.status = input.status;
      if (input.timezone !== undefined) trigger.timezone = input.timezone;

      const saved = await this.triggerRepo.save(trigger);

      logInfo('Trigger updated', { id: triggerId, status: saved.status });

      return { success: true, data: saved };
    } catch (error: any) {
      logError('Failed to update trigger', error);
      return { success: false, error: error.message };
    }
  }

  async deleteTrigger(triggerId: number): Promise<ServiceResponse<boolean>> {
    try {
      const result = await this.triggerRepo.delete({ id: triggerId });

      if (result.affected === 0) {
        return { success: false, error: 'Trigger not found' };
      }

      logInfo('Trigger deleted', { id: triggerId });
      return { success: true, data: true };
    } catch (error: any) {
      logError('Failed to delete trigger', error);
      return { success: false, error: error.message };
    }
  }

  async getTrigger(triggerId: number): Promise<ServiceResponse<Trigger>> {
    try {
      const trigger = await this.triggerRepo.findOne({ where: { id: triggerId } });

      if (!trigger) {
        return { success: false, error: 'Trigger not found' };
      }

      return { success: true, data: trigger };
    } catch (error: any) {
      logError('Failed to get trigger', error);
      return { success: false, error: error.message };
    }
  }

  async getUserTriggers(userId: string, status?: 'active' | 'paused' | 'completed'): Promise<ServiceResponse<Trigger[]>> {
    try {
      const where: any = { userId };
      if (status) {
        where.status = status;
      }

      const triggers = await this.triggerRepo.find({
        where,
        order: { nextTrigger: 'ASC' }
      });

      return { success: true, data: triggers };
    } catch (error: any) {
      logError('Failed to get user triggers', error);
      return { success: false, error: error.message };
    }
  }

  async getDueTriggers(): Promise<ServiceResponse<Trigger[]>> {
    try {
      const now = new Date();

      const triggers = await this.triggerRepo.find({
        where: {
          status: 'active',
          nextTrigger: LessThanOrEqual(now)
        },
        order: { nextTrigger: 'ASC' }
      });

      logDebug('Found due triggers', { count: triggers.length });

      return { success: true, data: triggers };
    } catch (error: any) {
      logError('Failed to get due triggers', error);
      return { success: false, error: error.message };
    }
  }

  async markTriggerExecuted(triggerId: number, error?: string): Promise<ServiceResponse<Trigger>> {
    try {
      const trigger = await this.triggerRepo.findOne({ where: { id: triggerId } });

      if (!trigger) {
        return { success: false, error: 'Trigger not found' };
      }

      // Update metadata
      trigger.metadata = {
        ...trigger.metadata,
        lastExecutionAt: new Date(),
        executionCount: (trigger.metadata.executionCount || 0) + 1
      };

      if (error) {
        trigger.lastError = error;
        trigger.metadata.lastError = error;
      } else {
        trigger.lastError = undefined;
      }

      // Calculate next trigger time for recurring triggers
      if (trigger.recurrenceRule) {
        trigger.nextTrigger = this.calculateNextTrigger(trigger.recurrenceRule, trigger.timezone);
        logDebug('Scheduled next trigger', {
          id: triggerId,
          nextTrigger: trigger.nextTrigger?.toISOString()
        });
      } else {
        // One-time trigger - mark as completed
        trigger.status = 'completed';
        trigger.nextTrigger = undefined;
      }

      const saved = await this.triggerRepo.save(trigger);

      logInfo('Trigger executed', {
        id: triggerId,
        status: saved.status,
        nextTrigger: saved.nextTrigger?.toISOString()
      });

      return { success: true, data: saved };
    } catch (error: any) {
      logError('Failed to mark trigger executed', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Calculate next trigger time based on recurrence rule.
   * Supports: daily, weekly, hourly, or cron-like patterns.
   */
  private calculateNextTrigger(recurrenceRule: string, timezone: string): Date | undefined {
    const now = new Date();
    const rule = recurrenceRule.toLowerCase().trim();

    // Simple interval patterns
    if (rule === 'hourly') {
      return new Date(now.getTime() + 60 * 60 * 1000);
    }
    if (rule === 'daily') {
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    }
    if (rule === 'weekly') {
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    }

    // Interval patterns like "every 2 hours", "every 30 minutes"
    const intervalMatch = rule.match(/every\s+(\d+)\s+(minute|hour|day|week)s?/i);
    if (intervalMatch) {
      const amount = parseInt(intervalMatch[1], 10);
      const unit = intervalMatch[2].toLowerCase();
      let ms = 0;
      switch (unit) {
        case 'minute': ms = amount * 60 * 1000; break;
        case 'hour': ms = amount * 60 * 60 * 1000; break;
        case 'day': ms = amount * 24 * 60 * 60 * 1000; break;
        case 'week': ms = amount * 7 * 24 * 60 * 60 * 1000; break;
      }
      if (ms > 0) {
        return new Date(now.getTime() + ms);
      }
    }

    // Try natural language parsing for time-of-day patterns
    // e.g., "daily at 9am", "every day at 3pm"
    const timeMatch = rule.match(/at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
    if (timeMatch) {
      const parsed = chrono.parseDate(`tomorrow at ${timeMatch[1]}`);
      if (parsed) {
        return parsed;
      }
    }

    logWarn('Could not parse recurrence rule', { recurrenceRule });
    return undefined;
  }

  /**
   * Parse a natural language trigger time.
   */
  parseNaturalTime(text: string): Date | null {
    return chrono.parseDate(text);
  }
}

// Singleton instance
let triggerServiceInstance: TriggerService | null = null;

export function getTriggerService(): TriggerService {
  if (!triggerServiceInstance) {
    triggerServiceInstance = new TriggerService();
  }
  return triggerServiceInstance;
}
