import { Repository } from 'typeorm';
import Bull from 'bull';
import * as chrono from 'chrono-node';
import { AppDataSource } from '../database/connection';
import { Reminder } from '../database/entities/Reminder';
import { User } from '../database/entities/User';
import { logInfo, logError, logDebug } from '../utils/logger';
import { ServiceResponse, Reminder as IReminder, ReminderMetadata } from '../types';
import { config } from '../config';

export class ReminderService {
  private reminderRepo: Repository<Reminder>;
  private userRepo: Repository<User>;
  private reminderQueue: Bull.Queue;

  constructor() {
    this.reminderRepo = AppDataSource.getRepository(Reminder);
    this.userRepo = AppDataSource.getRepository(User);
    
    // Initialize Bull queue for reminders
    this.reminderQueue = new Bull('reminders', {
      redis: {
        port: 6379,
        host: new URL(config.redis.url).hostname,
        password: new URL(config.redis.url).password
      }
    });

    this.setupQueueProcessors();
  }

  private setupQueueProcessors(): void {
    // Process reminder jobs
    this.reminderQueue.process(async (job) => {
      const { reminderId } = job.data;
      await this.sendReminder(reminderId);
    });

    // Queue event handlers
    this.reminderQueue.on('completed', (job) => {
      logInfo(`Reminder job completed: ${job.id}`);
    });

    this.reminderQueue.on('failed', (job, err) => {
      logError(`Reminder job failed: ${job.id}`, err);
    });
  }

  async createReminderFromText(
    userId: string,
    text: string,
    channel: 'imessage' | 'email' | 'both' = 'imessage'
  ): Promise<ServiceResponse<IReminder>> {
    try {
      logDebug('Parsing reminder from text', { userId, text });

      // Parse date/time from natural language
      const parsedDate = chrono.parseDate(text);
      
      if (!parsedDate) {
        return {
          success: false,
          error: 'Could not parse a date/time from the message'
        };
      }

      // Remove the date/time portion to get the reminder content
      const dateString = chrono.parse(text)[0]?.text || '';
      const content = text.replace(dateString, '').trim()
        .replace(/^(remind me to |remind me |reminder to |reminder )/i, '')
        .trim();

      if (!content) {
        return {
          success: false,
          error: 'No reminder content found'
        };
      }

      // Create the reminder
      const reminder = await this.createReminder(
        userId,
        content,
        parsedDate,
        channel,
        { originalMessage: text }
      );

      return reminder;
    } catch (error: any) {
      logError('Failed to create reminder from text', error);
      return {
        success: false,
        error: error.message || 'Failed to create reminder'
      };
    }
  }

  async createReminder(
    userId: string,
    content: string,
    remindAt: Date,
    channel: 'imessage' | 'email' | 'both' = 'imessage',
    metadata?: ReminderMetadata
  ): Promise<ServiceResponse<IReminder>> {
    try {
      // Validate remind time is in the future
      if (remindAt <= new Date()) {
        return {
          success: false,
          error: 'Reminder time must be in the future'
        };
      }

      // Create reminder in database
      const reminder = this.reminderRepo.create({
        userId,
        content,
        remindAt,
        channel,
        status: 'pending',
        metadata: metadata || {}
      });

      const savedReminder = await this.reminderRepo.save(reminder);
      
      // Schedule the reminder job
      const delay = remindAt.getTime() - Date.now();
      await this.reminderQueue.add(
        { reminderId: savedReminder.id },
        { delay }
      );

      logInfo('Reminder created', {
        id: savedReminder.id,
        remindAt: remindAt.toISOString()
      });

      return {
        success: true,
        data: this.mapToInterface(savedReminder)
      };
    } catch (error: any) {
      logError('Failed to create reminder', error);
      return {
        success: false,
        error: error.message || 'Failed to create reminder'
      };
    }
  }

  async sendReminder(reminderId: string): Promise<void> {
    try {
      const reminder = await this.reminderRepo.findOne({
        where: { id: reminderId },
        relations: ['user']
      });

      if (!reminder) {
        logError('Reminder not found', { reminderId });
        return;
      }

      if (reminder.status !== 'pending') {
        logDebug('Reminder already processed', { 
          reminderId, 
          status: reminder.status 
        });
        return;
      }

      // Import MessageRouter here to avoid circular dependency
      const { getMessageRouter } = await import('./MessageRouter');
      const messageRouter = await getMessageRouter();

      // Send the reminder message
      const messageText = `🔔 Reminder: ${reminder.content}`;
      
      if (reminder.channel === 'imessage' || reminder.channel === 'both') {
        const result = await messageRouter.sendProactiveMessage(
          reminder.userId,
          messageText,
          'imessage'
        );

        if (result.success) {
          reminder.status = 'sent';
          reminder.completedAt = new Date();
          await this.reminderRepo.save(reminder);
          
          logInfo('Reminder sent successfully', { reminderId });
        } else {
          throw new Error(result.error || 'Failed to send reminder');
        }
      }

      // Email reminders would be handled here when email is implemented
      if (reminder.channel === 'email' || reminder.channel === 'both') {
        logDebug('Email reminders not yet implemented');
      }
    } catch (error: unknown) {
      logError('Failed to send reminder', error);
      
      // Retry logic could be added here
      const reminder = await this.reminderRepo.findOne({
        where: { id: reminderId }
      });
      
      if (reminder) {
        reminder.metadata = {
          ...reminder.metadata,
          lastError: (error as Error).message || 'Unknown error',
          failedAt: new Date().toISOString()
        };
        await this.reminderRepo.save(reminder);
      }
    }
  }

  async getUserReminders(
    userId: string,
    status?: 'pending' | 'sent' | 'snoozed' | 'cancelled'
  ): Promise<ServiceResponse<IReminder[]>> {
    try {
      const where: any = { userId };
      
      if (status) {
        where.status = status;
      }

      const reminders = await this.reminderRepo.find({
        where,
        order: { remindAt: 'ASC' }
      });

      return {
        success: true,
        data: reminders.map(r => this.mapToInterface(r))
      };
    } catch (error: any) {
      logError('Failed to get user reminders', error);
      return {
        success: false,
        error: error.message || 'Failed to get reminders'
      };
    }
  }

  async snoozeReminder(
    reminderId: string,
    snoozeDuration: number = 15 * 60 * 1000 // Default 15 minutes
  ): Promise<ServiceResponse<IReminder>> {
    try {
      const reminder = await this.reminderRepo.findOne({
        where: { id: reminderId }
      });

      if (!reminder) {
        return {
          success: false,
          error: 'Reminder not found'
        };
      }

      // Update reminder
      const newRemindAt = new Date(Date.now() + snoozeDuration);
      reminder.remindAt = newRemindAt;
      reminder.status = 'snoozed';
      reminder.metadata = {
        ...reminder.metadata,
        snoozeCount: (reminder.metadata.snoozeCount || 0) + 1,
        lastSnoozeAt: new Date()
      };

      const updatedReminder = await this.reminderRepo.save(reminder);

      // Reschedule the job
      await this.reminderQueue.add(
        { reminderId },
        { delay: snoozeDuration }
      );

      logInfo('Reminder snoozed', { reminderId, newRemindAt });

      return {
        success: true,
        data: this.mapToInterface(updatedReminder)
      };
    } catch (error: any) {
      logError('Failed to snooze reminder', error);
      return {
        success: false,
        error: error.message || 'Failed to snooze reminder'
      };
    }
  }

  async cancelReminder(reminderId: string): Promise<ServiceResponse<boolean>> {
    try {
      const reminder = await this.reminderRepo.findOne({
        where: { id: reminderId }
      });

      if (!reminder) {
        return {
          success: false,
          error: 'Reminder not found'
        };
      }

      reminder.status = 'cancelled';
      reminder.completedAt = new Date();
      await this.reminderRepo.save(reminder);

      // Remove from queue if pending
      const jobs = await this.reminderQueue.getJobs(['delayed', 'waiting']);
      for (const job of jobs) {
        if (job.data.reminderId === reminderId) {
          await job.remove();
          break;
        }
      }

      logInfo('Reminder cancelled', { reminderId });

      return {
        success: true,
        data: true
      };
    } catch (error: any) {
      logError('Failed to cancel reminder', error);
      return {
        success: false,
        error: error.message || 'Failed to cancel reminder'
      };
    }
  }

  async getUpcomingReminders(
    userId: string,
    hours: number = 24
  ): Promise<ServiceResponse<IReminder[]>> {
    try {
      const cutoffTime = new Date(Date.now() + hours * 60 * 60 * 1000);
      
      const reminders = await this.reminderRepo
        .createQueryBuilder('reminder')
        .where('reminder.userId = :userId', { userId })
        .andWhere('reminder.status = :status', { status: 'pending' })
        .andWhere('reminder.remindAt <= :cutoffTime', { cutoffTime })
        .andWhere('reminder.remindAt >= :now', { now: new Date() })
        .orderBy('reminder.remindAt', 'ASC')
        .getMany();

      return {
        success: true,
        data: reminders.map(r => this.mapToInterface(r))
      };
    } catch (error: any) {
      logError('Failed to get upcoming reminders', error);
      return {
        success: false,
        error: error.message || 'Failed to get upcoming reminders'
      };
    }
  }

  private mapToInterface(reminder: Reminder): IReminder {
    return {
      id: reminder.id,
      userId: reminder.userId,
      content: reminder.content,
      remindAt: reminder.remindAt,
      channel: reminder.channel,
      status: reminder.status,
      metadata: reminder.metadata,
      createdAt: reminder.createdAt,
      updatedAt: reminder.updatedAt,
      completedAt: reminder.completedAt
    };
  }
}

// Singleton instance
let reminderServiceInstance: ReminderService | null = null;

export const getReminderService = (): ReminderService => {
  if (!reminderServiceInstance) {
    reminderServiceInstance = new ReminderService();
  }
  return reminderServiceInstance;
};

export default ReminderService;
