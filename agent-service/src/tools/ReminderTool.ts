import { BaseTool, ToolDefinition, ToolExecutionContext, ToolResult } from './Tool';
import { getReminderService } from '../services/ReminderService';
import { logInfo, logError } from '../utils/logger';
import * as chrono from 'chrono-node';

/**
 * Tool for creating reminders via Claude.
 * Allows the AI to set reminders that will notify the user at a specific time via iMessage.
 */
export class CreateReminderTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'create_reminder',
      description: 'Create a reminder that will notify the user at a specific time via iMessage. Use this when the user asks to be reminded about something, wants to set an alarm, or needs a future notification. The reminder will be delivered as an iMessage at the specified time. Do NOT use this for immediate actions - only for scheduling future notifications.',
      input_schema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The reminder message to send to the user. Should be clear, actionable, and include relevant context from the original request.'
          },
          remind_at: {
            type: 'string',
            description: 'When to send the reminder. Accepts ISO 8601 datetime (e.g., "2024-12-21T15:00:00-06:00") or natural language (e.g., "tomorrow at 3pm", "in 2 hours", "next Monday at 9am"). Times are interpreted in the user\'s timezone.'
          },
          channel: {
            type: 'string',
            enum: ['imessage', 'email'],
            description: 'Delivery channel for the reminder. Defaults to imessage. Use email only if user explicitly requests it.'
          }
        },
        required: ['content', 'remind_at']
      }
    };
  }

  async execute(input: { content: string; remind_at: string; channel?: string }, context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const { content, remind_at, channel = 'imessage' } = input;

      // Parse the remind_at time
      let remindAtDate: Date | null = null;

      // Try ISO 8601 first
      const isoDate = new Date(remind_at);
      if (!isNaN(isoDate.getTime())) {
        remindAtDate = isoDate;
      } else {
        // Try natural language parsing
        remindAtDate = chrono.parseDate(remind_at);
      }

      if (!remindAtDate) {
        return this.error(`Could not parse time: "${remind_at}". Please use a format like "tomorrow at 3pm" or "2024-12-21T15:00:00".`);
      }

      // Validate time is in the future
      if (remindAtDate <= new Date()) {
        return this.error('Reminder time must be in the future.');
      }

      const reminderService = getReminderService();
      const result = await reminderService.createReminder(
        context.userId,
        content,
        remindAtDate,
        channel as 'imessage' | 'email' | 'both'
      );

      if (result.success && result.data) {
        logInfo('Reminder created via tool', {
          reminderId: result.data.id,
          userId: context.userId,
          remindAt: remindAtDate.toISOString()
        });

        return this.success({
          reminder_id: result.data.id,
          content: result.data.content,
          remind_at: result.data.remindAt.toISOString(),
          channel: result.data.channel,
          message: `Reminder set for ${remindAtDate.toLocaleString()}`
        });
      }

      return this.error(result.error || 'Failed to create reminder');
    } catch (error: any) {
      logError('CreateReminderTool execution failed', error);
      return this.error(error.message || 'Failed to create reminder');
    }
  }
}

/**
 * Tool for listing user's pending reminders.
 */
export class ListRemindersTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'list_reminders',
      description: 'List the user\'s pending reminders. Use this when the user asks about their reminders, wants to see what\'s scheduled, or needs to review upcoming notifications.',
      input_schema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['pending', 'sent', 'snoozed', 'cancelled', 'all'],
            description: 'Filter reminders by status. Defaults to "pending" to show only upcoming reminders.'
          }
        },
        required: []
      }
    };
  }

  async execute(input: { status?: string }, context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const { status = 'pending' } = input;
      const reminderService = getReminderService();

      const statusFilter = status === 'all' ? undefined : status as 'pending' | 'sent' | 'snoozed' | 'cancelled';
      const result = await reminderService.getUserReminders(context.userId, statusFilter);

      if (result.success && result.data) {
        const reminders = result.data.map(r => ({
          id: r.id,
          content: r.content,
          remind_at: r.remindAt.toISOString(),
          status: r.status,
          channel: r.channel
        }));

        return this.success({
          count: reminders.length,
          reminders,
          message: reminders.length > 0 
            ? `Found ${reminders.length} reminder(s)` 
            : 'No reminders found'
        });
      }

      return this.error(result.error || 'Failed to list reminders');
    } catch (error: any) {
      logError('ListRemindersTool execution failed', error);
      return this.error(error.message || 'Failed to list reminders');
    }
  }
}

/**
 * Tool for cancelling a reminder.
 */
export class CancelReminderTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'cancel_reminder',
      description: 'Cancel a pending reminder. Use this when the user wants to remove a scheduled reminder. You should first use list_reminders to find the reminder ID, then confirm with the user which one to cancel.',
      input_schema: {
        type: 'object',
        properties: {
          reminder_id: {
            type: 'string',
            description: 'The ID of the reminder to cancel. Get this from list_reminders.'
          }
        },
        required: ['reminder_id']
      }
    };
  }

  async execute(input: { reminder_id: string }, context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const { reminder_id } = input;
      const reminderService = getReminderService();

      const result = await reminderService.cancelReminder(reminder_id);

      if (result.success) {
        logInfo('Reminder cancelled via tool', {
          reminderId: reminder_id,
          userId: context.userId
        });

        return this.success({
          reminder_id,
          cancelled: true,
          message: 'Reminder cancelled successfully'
        });
      }

      return this.error(result.error || 'Failed to cancel reminder');
    } catch (error: any) {
      logError('CancelReminderTool execution failed', error);
      return this.error(error.message || 'Failed to cancel reminder');
    }
  }
}

// Export tool instances for registration
export const createReminderTool = new CreateReminderTool();
export const listRemindersTool = new ListRemindersTool();
export const cancelReminderTool = new CancelReminderTool();
