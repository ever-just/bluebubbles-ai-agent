import { BaseTool, ToolDefinition, ToolExecutionContext, ToolResult } from './Tool';
import { getAgentMailClient } from '../integrations/AgentMailClient';
import { logInfo, logError } from '../utils/logger';

/**
 * Tool for sending emails via AgentMail.
 */
export class SendEmailTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'send_email',
      description: 'Send an email on behalf of the user. Use this when the user asks you to send an email, compose a message, or reach out to someone via email. The email will be sent from the agent\'s dedicated email address.',
      input_schema: {
        type: 'object',
        properties: {
          to: {
            type: 'string',
            description: 'The recipient email address (e.g., "john@example.com")'
          },
          subject: {
            type: 'string',
            description: 'The email subject line'
          },
          body: {
            type: 'string',
            description: 'The email body content in plain text'
          },
          cc: {
            type: 'string',
            description: 'Optional CC recipient email address'
          }
        },
        required: ['to', 'subject', 'body']
      }
    };
  }

  async execute(
    input: { to: string; subject: string; body: string; cc?: string },
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    try {
      const { to, subject, body, cc } = input;

      const client = getAgentMailClient();
      if (!client.isEnabled()) {
        return this.error('Email functionality is not configured. Please set up AgentMail.');
      }

      logInfo('SendEmailTool executing', {
        userId: context.userId,
        to,
        subject: subject.substring(0, 50)
      });

      const result = await client.sendEmail(context.userId, to, subject, body, { cc });

      if (result.success) {
        return this.success({
          message: `Email sent successfully to ${to}`,
          messageId: result.messageId
        });
      } else {
        return this.error(result.error || 'Failed to send email');
      }
    } catch (error: any) {
      logError('SendEmailTool failed', error);
      return this.error(`Failed to send email: ${error.message}`);
    }
  }
}

/**
 * Tool for listing emails in the agent's inbox.
 */
export class ListEmailsTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'list_emails',
      description: 'List recent emails in the agent\'s inbox. Use this when the user asks about their emails, wants to check for new messages, or needs to see what emails have been received.',
      input_schema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of emails to return (default: 10, max: 25)'
          }
        },
        required: []
      }
    };
  }

  async execute(
    input: { limit?: number },
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    try {
      const limit = Math.min(input.limit || 10, 25);

      const client = getAgentMailClient();
      if (!client.isEnabled()) {
        return this.error('Email functionality is not configured. Please set up AgentMail.');
      }

      logInfo('ListEmailsTool executing', {
        userId: context.userId,
        limit
      });

      const result = await client.listEmails(context.userId, { limit });

      if (result.success) {
        return this.success({
          emails: result.emails,
          count: result.emails?.length || 0
        });
      } else {
        return this.error(result.error || 'Failed to list emails');
      }
    } catch (error: any) {
      logError('ListEmailsTool failed', error);
      return this.error(`Failed to list emails: ${error.message}`);
    }
  }
}

/**
 * Tool for reading a specific email.
 */
export class ReadEmailTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'read_email',
      description: 'Read the full content of a specific email by its message ID. Use this after listing emails to get the complete details of a particular message.',
      input_schema: {
        type: 'object',
        properties: {
          message_id: {
            type: 'string',
            description: 'The message ID of the email to read (obtained from list_emails)'
          }
        },
        required: ['message_id']
      }
    };
  }

  async execute(
    input: { message_id: string },
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    try {
      const { message_id } = input;

      const client = getAgentMailClient();
      if (!client.isEnabled()) {
        return this.error('Email functionality is not configured. Please set up AgentMail.');
      }

      logInfo('ReadEmailTool executing', {
        userId: context.userId,
        messageId: message_id
      });

      const result = await client.getEmail(context.userId, message_id);

      if (result.success) {
        return this.success({
          email: result.email
        });
      } else {
        return this.error(result.error || 'Failed to read email');
      }
    } catch (error: any) {
      logError('ReadEmailTool failed', error);
      return this.error(`Failed to read email: ${error.message}`);
    }
  }
}

/**
 * Tool for replying to an email.
 */
export class ReplyEmailTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'reply_email',
      description: 'Reply to an existing email. Use this when the user wants to respond to an email they received.',
      input_schema: {
        type: 'object',
        properties: {
          message_id: {
            type: 'string',
            description: 'The message ID of the email to reply to'
          },
          body: {
            type: 'string',
            description: 'The reply message content in plain text'
          }
        },
        required: ['message_id', 'body']
      }
    };
  }

  async execute(
    input: { message_id: string; body: string },
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    try {
      const { message_id, body } = input;

      const client = getAgentMailClient();
      if (!client.isEnabled()) {
        return this.error('Email functionality is not configured. Please set up AgentMail.');
      }

      logInfo('ReplyEmailTool executing', {
        userId: context.userId,
        messageId: message_id
      });

      const result = await client.replyToEmail(context.userId, message_id, body);

      if (result.success) {
        return this.success({
          message: 'Reply sent successfully',
          messageId: result.messageId
        });
      } else {
        return this.error(result.error || 'Failed to reply to email');
      }
    } catch (error: any) {
      logError('ReplyEmailTool failed', error);
      return this.error(`Failed to reply to email: ${error.message}`);
    }
  }
}

/**
 * Tool for getting the agent's email address.
 */
export class GetAgentEmailTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'get_agent_email',
      description: 'Get the agent\'s email address. Use this when the user asks what email address they can share or use for the agent.',
      input_schema: {
        type: 'object',
        properties: {},
        required: []
      }
    };
  }

  async execute(
    _input: Record<string, never>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    try {
      const client = getAgentMailClient();
      if (!client.isEnabled()) {
        return this.error('Email functionality is not configured. Please set up AgentMail.');
      }

      logInfo('GetAgentEmailTool executing', {
        userId: context.userId
      });

      const emailAddress = await client.getAgentEmailAddress(context.userId);

      if (emailAddress) {
        return this.success({
          emailAddress,
          message: `The agent's email address is: ${emailAddress}`
        });
      } else {
        return this.error('Could not retrieve agent email address');
      }
    } catch (error: any) {
      logError('GetAgentEmailTool failed', error);
      return this.error(`Failed to get agent email: ${error.message}`);
    }
  }
}

// Export tool instances
export const sendEmailTool = new SendEmailTool();
export const listEmailsTool = new ListEmailsTool();
export const readEmailTool = new ReadEmailTool();
export const replyEmailTool = new ReplyEmailTool();
export const getAgentEmailTool = new GetAgentEmailTool();
