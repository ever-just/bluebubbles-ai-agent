import { readFileSync } from 'fs';
import { join } from 'path';
import { logInfo, logError, logDebug } from '../utils/logger';
import { ToolDefinition, ToolResult } from '../tools/Tool';

// Load system prompt from markdown file
const PROMPT_PATH = join(__dirname, 'prompts/interaction_system_prompt.md');
let INTERACTION_SYSTEM_PROMPT: string;
try {
  INTERACTION_SYSTEM_PROMPT = readFileSync(PROMPT_PATH, 'utf-8');
} catch (error) {
  logError('Failed to load interaction system prompt, using fallback', error);
  INTERACTION_SYSTEM_PROMPT = 'You are Grace, an executive assistant. Acknowledge requests and delegate tasks to execution agents.';
}

/**
 * Tool definitions for the Interaction Agent.
 * These tools allow the agent to communicate with users and delegate to execution agents.
 */
export const INTERACTION_AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'send_message_to_agent',
    description: 'Deliver instructions to a specific execution agent. Creates a new agent if the name doesn\'t exist in the roster, or reuses an existing one. Use this for any task that requires tool execution.',
    input_schema: {
      type: 'object',
      properties: {
        agent_name: {
          type: 'string',
          description: 'Human-readable agent name describing its purpose (e.g., "Reminder Agent", "Weather Lookup"). This name will be used to identify and potentially reuse the agent.'
        },
        instructions: {
          type: 'string',
          description: 'Clear instructions for the agent to execute. Include all relevant context from the user\'s request.'
        }
      },
      required: ['agent_name', 'instructions']
    }
  },
  {
    name: 'send_message_to_user',
    description: 'Deliver a natural-language response directly to the user via iMessage. Use this for acknowledgments, updates, results, or any message the user should see. Use "||" to split into multiple iMessage bubbles.',
    input_schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Plain-text message to send to the user. Use "||" delimiter to split into multiple iMessage bubbles (max 3 bubbles recommended).'
        }
      },
      required: ['message']
    }
  },
  {
    name: 'wait',
    description: 'Wait silently without sending a response. Use this when a message is already in conversation history to avoid duplicating responses, or when processing doesn\'t require user notification.',
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Brief explanation of why waiting (e.g., "Message already sent", "Duplicate response detected", "Processing agent result").'
        }
      },
      required: ['reason']
    }
  }
];

/**
 * Result types for interaction agent tool execution
 */
export interface SendToAgentResult {
  agentName: string;
  instructions: string;
  requestId: string;
}

export interface SendToUserResult {
  message: string;
  bubbleCount: number;
}

export interface WaitResult {
  reason: string;
}

export type InteractionToolResult = SendToAgentResult | SendToUserResult | WaitResult;

/**
 * InteractionAgent handles user-facing communication and delegates tasks to execution agents.
 */
export class InteractionAgent {
  private conversationId: string;
  private userId: string;

  constructor(conversationId: string, userId: string) {
    this.conversationId = conversationId;
    this.userId = userId;
  }

  getSystemPrompt(): string {
    return INTERACTION_SYSTEM_PROMPT;
  }

  getToolDefinitions(): ToolDefinition[] {
    return INTERACTION_AGENT_TOOLS;
  }

  /**
   * Execute an interaction agent tool.
   * Returns the result which will be handled by the runtime.
   */
  async executeTool(toolName: string, input: any): Promise<ToolResult> {
    logDebug('InteractionAgent executing tool', { toolName, input });

    switch (toolName) {
      case 'send_message_to_agent':
        return this.handleSendToAgent(input);
      
      case 'send_message_to_user':
        return this.handleSendToUser(input);
      
      case 'wait':
        return this.handleWait(input);
      
      default:
        return {
          success: false,
          error: `Unknown interaction tool: ${toolName}`
        };
    }
  }

  private handleSendToAgent(input: { agent_name: string; instructions: string }): ToolResult {
    const { agent_name, instructions } = input;
    const requestId = crypto.randomUUID();

    logInfo('InteractionAgent delegating to execution agent', {
      agentName: agent_name,
      requestId,
      instructionsPreview: instructions.substring(0, 100)
    });

    return {
      success: true,
      data: {
        type: 'send_to_agent',
        agentName: agent_name,
        instructions,
        requestId
      } as SendToAgentResult & { type: string }
    };
  }

  private handleSendToUser(input: { message: string }): ToolResult {
    const { message } = input;
    const bubbles = message.split('||').map(b => b.trim()).filter(Boolean);

    logInfo('InteractionAgent sending to user', {
      bubbleCount: bubbles.length,
      messagePreview: message.substring(0, 100)
    });

    return {
      success: true,
      data: {
        type: 'send_to_user',
        message,
        bubbles,
        bubbleCount: bubbles.length
      } as SendToUserResult & { type: string; bubbles: string[] }
    };
  }

  private handleWait(input: { reason: string }): ToolResult {
    const { reason } = input;

    logDebug('InteractionAgent waiting', { reason });

    return {
      success: true,
      data: {
        type: 'wait',
        reason
      } as WaitResult & { type: string }
    };
  }
}

// Factory function
export function createInteractionAgent(conversationId: string, userId: string): InteractionAgent {
  return new InteractionAgent(conversationId, userId);
}
