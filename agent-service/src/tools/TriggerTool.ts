import { BaseTool, ToolDefinition, ToolExecutionContext, ToolResult } from './Tool';
import { getTriggerService } from '../services/TriggerService';
import { logInfo, logError } from '../utils/logger';
import * as chrono from 'chrono-node';

/**
 * Tool for creating triggers that spawn execution agents at scheduled times.
 */
export class CreateTriggerTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'create_trigger',
      description: 'Create a scheduled trigger that will spawn an execution agent at a specific time or on a recurring schedule. Use this for tasks that need to run automatically, like daily summaries, periodic checks, or scheduled notifications.',
      input_schema: {
        type: 'object',
        properties: {
          agent_name: {
            type: 'string',
            description: 'Name of the execution agent to spawn when the trigger fires (e.g., "Daily Summary Agent", "Weather Check Agent").'
          },
          payload: {
            type: 'string',
            description: 'Instructions to send to the execution agent when the trigger fires.'
          },
          start_time: {
            type: 'string',
            description: 'When to first fire the trigger. Accepts ISO 8601 datetime or natural language (e.g., "tomorrow at 9am", "in 2 hours", "next Monday at 3pm").'
          },
          recurrence_rule: {
            type: 'string',
            description: 'Optional recurrence pattern. Supports: "hourly", "daily", "weekly", or "every N minutes/hours/days" (e.g., "every 2 hours", "daily at 9am").'
          },
          timezone: {
            type: 'string',
            description: 'Timezone for the trigger (default: America/Chicago). Use IANA timezone names.'
          }
        },
        required: ['agent_name', 'payload', 'start_time']
      }
    };
  }

  async execute(
    input: { agent_name: string; payload: string; start_time: string; recurrence_rule?: string; timezone?: string },
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    try {
      const { agent_name, payload, start_time, recurrence_rule, timezone } = input;

      // Parse start time
      let startTime: Date | null = null;
      const isoDate = new Date(start_time);
      if (!isNaN(isoDate.getTime())) {
        startTime = isoDate;
      } else {
        startTime = chrono.parseDate(start_time);
      }

      if (!startTime) {
        return this.error(`Could not parse start time: "${start_time}"`);
      }

      if (startTime <= new Date() && !recurrence_rule) {
        return this.error('Start time must be in the future for one-time triggers.');
      }

      const triggerService = getTriggerService();
      const result = await triggerService.createTrigger({
        userId: context.userId,
        agentName: agent_name,
        payload,
        startTime,
        recurrenceRule: recurrence_rule,
        timezone
      });

      if (result.success && result.data) {
        logInfo('Trigger created via tool', {
          triggerId: result.data.id,
          agentName: agent_name,
          userId: context.userId
        });

        return this.success({
          trigger_id: result.data.id,
          agent_name: result.data.agentName,
          next_trigger: result.data.nextTrigger?.toISOString(),
          recurrence_rule: result.data.recurrenceRule,
          message: `Trigger created. Will fire at ${result.data.nextTrigger?.toLocaleString()}`
        });
      }

      return this.error(result.error || 'Failed to create trigger');
    } catch (error: any) {
      logError('CreateTriggerTool execution failed', error);
      return this.error(error.message || 'Failed to create trigger');
    }
  }
}

/**
 * Tool for listing user's triggers.
 */
export class ListTriggersTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'list_triggers',
      description: 'List the user\'s scheduled triggers. Use this to see what automated tasks are set up.',
      input_schema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['active', 'paused', 'completed', 'all'],
            description: 'Filter triggers by status. Defaults to "active".'
          }
        },
        required: []
      }
    };
  }

  async execute(input: { status?: string }, context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const { status = 'active' } = input;
      const triggerService = getTriggerService();

      const statusFilter = status === 'all' ? undefined : status as 'active' | 'paused' | 'completed';
      const result = await triggerService.getUserTriggers(context.userId, statusFilter);

      if (result.success && result.data) {
        const triggers = result.data.map(t => ({
          id: t.id,
          agent_name: t.agentName,
          payload_preview: t.payload.substring(0, 50) + (t.payload.length > 50 ? '...' : ''),
          next_trigger: t.nextTrigger?.toISOString(),
          recurrence_rule: t.recurrenceRule,
          status: t.status
        }));

        return this.success({
          count: triggers.length,
          triggers,
          message: triggers.length > 0 ? `Found ${triggers.length} trigger(s)` : 'No triggers found'
        });
      }

      return this.error(result.error || 'Failed to list triggers');
    } catch (error: any) {
      logError('ListTriggersTool execution failed', error);
      return this.error(error.message || 'Failed to list triggers');
    }
  }
}

/**
 * Tool for updating a trigger.
 */
export class UpdateTriggerTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'update_trigger',
      description: 'Update an existing trigger. Can change the payload, schedule, or pause/resume it.',
      input_schema: {
        type: 'object',
        properties: {
          trigger_id: {
            type: 'number',
            description: 'The ID of the trigger to update.'
          },
          payload: {
            type: 'string',
            description: 'New instructions for the execution agent.'
          },
          recurrence_rule: {
            type: 'string',
            description: 'New recurrence pattern.'
          },
          status: {
            type: 'string',
            enum: ['active', 'paused'],
            description: 'Set to "paused" to temporarily disable, or "active" to resume.'
          }
        },
        required: ['trigger_id']
      }
    };
  }

  async execute(
    input: { trigger_id: number; payload?: string; recurrence_rule?: string; status?: string },
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    try {
      const { trigger_id, payload, recurrence_rule, status } = input;
      const triggerService = getTriggerService();

      const result = await triggerService.updateTrigger(trigger_id, {
        payload,
        recurrenceRule: recurrence_rule,
        status: status as 'active' | 'paused' | undefined
      });

      if (result.success && result.data) {
        logInfo('Trigger updated via tool', { triggerId: trigger_id });

        return this.success({
          trigger_id: result.data.id,
          status: result.data.status,
          next_trigger: result.data.nextTrigger?.toISOString(),
          message: 'Trigger updated successfully'
        });
      }

      return this.error(result.error || 'Failed to update trigger');
    } catch (error: any) {
      logError('UpdateTriggerTool execution failed', error);
      return this.error(error.message || 'Failed to update trigger');
    }
  }
}

/**
 * Tool for deleting a trigger.
 */
export class DeleteTriggerTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'delete_trigger',
      description: 'Delete a scheduled trigger. This permanently removes the trigger.',
      input_schema: {
        type: 'object',
        properties: {
          trigger_id: {
            type: 'number',
            description: 'The ID of the trigger to delete.'
          }
        },
        required: ['trigger_id']
      }
    };
  }

  async execute(input: { trigger_id: number }, context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const { trigger_id } = input;
      const triggerService = getTriggerService();

      const result = await triggerService.deleteTrigger(trigger_id);

      if (result.success) {
        logInfo('Trigger deleted via tool', { triggerId: trigger_id });
        return this.success({
          trigger_id,
          deleted: true,
          message: 'Trigger deleted successfully'
        });
      }

      return this.error(result.error || 'Failed to delete trigger');
    } catch (error: any) {
      logError('DeleteTriggerTool execution failed', error);
      return this.error(error.message || 'Failed to delete trigger');
    }
  }
}

// Export tool instances
export const createTriggerTool = new CreateTriggerTool();
export const listTriggersTool = new ListTriggersTool();
export const updateTriggerTool = new UpdateTriggerTool();
export const deleteTriggerTool = new DeleteTriggerTool();
