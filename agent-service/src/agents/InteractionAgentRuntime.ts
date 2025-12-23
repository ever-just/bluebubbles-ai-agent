import Anthropic from '@anthropic-ai/sdk';
import { InteractionAgent, createInteractionAgent, INTERACTION_AGENT_TOOLS } from './InteractionAgent';
import { ExecutionBatchManager, createExecutionBatchManager } from './ExecutionBatchManager';
import { iMessageAdapter, getIMessageAdapter } from './iMessageAdapter';
import { ToolExecutionContext } from '../tools/Tool';
import { logInfo, logError, logDebug, logWarn } from '../utils/logger';
import { config } from '../config';

const MAX_TOOL_ITERATIONS = 8;

/**
 * Result from interaction agent processing.
 */
export interface InteractionResult {
  success: boolean;
  messagesSent: string[];
  agentsSpawned: string[];
  waitReasons: string[];
  iterationCount: number;
  error?: string;
}

/**
 * InteractionAgentRuntime manages the LLM loop for user-facing interactions.
 * Handles tool calls for send_message_to_user, send_message_to_agent, and wait.
 */
export class InteractionAgentRuntime {
  private agent: InteractionAgent;
  private anthropic: Anthropic;
  private batchManager: ExecutionBatchManager;
  private iMessageAdapter: iMessageAdapter;
  private context: ToolExecutionContext;
  private chatGuid: string;
  private conversationHistory: Array<{ role: string; content: string }>;

  constructor(
    conversationId: string,
    userId: string,
    chatGuid: string,
    context: ToolExecutionContext,
    conversationHistory: Array<{ role: string; content: string }> = []
  ) {
    this.agent = createInteractionAgent(conversationId, userId);
    this.context = context;
    this.chatGuid = chatGuid;
    this.conversationHistory = conversationHistory;
    
    this.anthropic = new Anthropic({
      apiKey: config.anthropic.apiKey
    });

    this.batchManager = createExecutionBatchManager(context);
    this.iMessageAdapter = getIMessageAdapter();

    // Set up batch completion callback
    this.batchManager.setOnBatchComplete(async (payload) => {
      await this.handleAgentMessage(payload);
    });
  }

  /**
   * Process a new user message.
   */
  async processUserMessage(userMessage: string): Promise<InteractionResult> {
    return this.runInteractionLoop('user', userMessage);
  }

  /**
   * Handle results from execution agents.
   */
  async handleAgentMessage(agentPayload: string): Promise<InteractionResult> {
    return this.runInteractionLoop('agent', agentPayload);
  }

  /**
   * Run the interaction agent loop.
   */
  private async runInteractionLoop(
    messageType: 'user' | 'agent',
    content: string
  ): Promise<InteractionResult> {
    const messagesSent: string[] = [];
    const agentsSpawned: string[] = [];
    const waitReasons: string[] = [];
    let iterationCount = 0;

    // Build structured context
    const structuredContent = this.buildStructuredContent(messageType, content);
    
    // Build messages for Claude
    const systemPrompt = this.agent.getSystemPrompt();
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: structuredContent }
    ];

    logInfo('InteractionAgentRuntime starting', {
      messageType,
      contentPreview: content.substring(0, 100)
    });

    try {
      while (iterationCount < MAX_TOOL_ITERATIONS) {
        iterationCount++;

        logDebug('InteractionAgentRuntime iteration', { iteration: iterationCount });

        // Call Claude with interaction tools
        const response = await this.anthropic.messages.create({
          model: config.anthropic.model || 'claude-sonnet-4-20250514',
          max_tokens: config.anthropic.responseMaxTokens || 1024,
          system: systemPrompt,
          tools: INTERACTION_AGENT_TOOLS as any,
          messages
        });

        // Check for tool use
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        );

        // If no tool use, we're done
        if (toolUseBlocks.length === 0) {
          logInfo('InteractionAgentRuntime completed (no more tools)', {
            iterationCount,
            messagesSent: messagesSent.length,
            agentsSpawned: agentsSpawned.length
          });

          return {
            success: true,
            messagesSent,
            agentsSpawned,
            waitReasons,
            iterationCount
          };
        }

        // Process tool calls
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolUse of toolUseBlocks) {
          const toolName = toolUse.name;
          const toolInput = toolUse.input as Record<string, any>;

          logDebug('InteractionAgentRuntime processing tool', { toolName, input: toolInput });

          // Execute the interaction tool
          const result = await this.agent.executeTool(toolName, toolInput);

          if (result.success && result.data) {
            const data = result.data as { type: string; [key: string]: any };

            switch (data.type) {
              case 'send_to_user':
                // Send message via iMessage
                await this.iMessageAdapter.sendToUser(data.message, this.chatGuid);
                messagesSent.push(data.message);
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: `Message sent to user: "${data.message.substring(0, 50)}..."`
                });
                break;

              case 'send_to_agent':
                // Spawn execution agent (async - don't await here)
                agentsSpawned.push(data.agentName);
                this.batchManager.executeAgent(
                  data.agentName,
                  data.instructions,
                  data.requestId
                ).catch(error => {
                  logError('Execution agent failed', error);
                });
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: `Agent "${data.agentName}" spawned with request ID: ${data.requestId}`
                });
                break;

              case 'wait':
                waitReasons.push(data.reason);
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: `Waiting: ${data.reason}`
                });
                break;

              default:
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: `Unknown tool result type: ${data.type}`
                });
            }
          } else {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: `Error: ${result.error || 'Unknown error'}`
            });
          }
        }

        // Add assistant response and tool results to messages
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });
      }

      // Max iterations reached
      logWarn('InteractionAgentRuntime max iterations reached', {
        maxIterations: MAX_TOOL_ITERATIONS
      });

      return {
        success: false,
        messagesSent,
        agentsSpawned,
        waitReasons,
        iterationCount,
        error: 'Max iterations reached'
      };

    } catch (error: any) {
      logError('InteractionAgentRuntime failed', error);

      return {
        success: false,
        messagesSent,
        agentsSpawned,
        waitReasons,
        iterationCount,
        error: error.message
      };
    }
  }

  /**
   * Build structured XML content for Claude.
   */
  private buildStructuredContent(messageType: 'user' | 'agent', content: string): string {
    const parts: string[] = [];

    // Add conversation history if available
    if (this.conversationHistory.length > 0) {
      const historyText = this.conversationHistory
        .slice(-10) // Last 10 messages
        .map(m => `<${m.role}_message>${this.escapeXml(m.content)}</${m.role}_message>`)
        .join('\n');
      parts.push(`<conversation_history>\n${historyText}\n</conversation_history>`);
    }

    // Add active agents if any
    const pendingCount = this.batchManager.getPendingCount();
    if (pendingCount > 0) {
      parts.push(`<active_agents>\n${pendingCount} agent(s) currently executing\n</active_agents>`);
    }

    // Add the new message
    if (messageType === 'user') {
      parts.push(`<new_user_message>\n${this.escapeXml(content)}\n</new_user_message>`);
    } else {
      parts.push(`<new_agent_message>\n${this.escapeXml(content)}\n</new_agent_message>`);
    }

    return parts.join('\n\n');
  }

  /**
   * Escape XML special characters.
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

// Singleton instance for handling agent callbacks
let runtimeInstance: InteractionAgentRuntime | null = null;

export function getInteractionAgentRuntime(): InteractionAgentRuntime | null {
  return runtimeInstance;
}

export function setInteractionAgentRuntime(runtime: InteractionAgentRuntime): void {
  runtimeInstance = runtime;
}

export function createInteractionAgentRuntime(
  conversationId: string,
  userId: string,
  chatGuid: string,
  context: ToolExecutionContext,
  conversationHistory: Array<{ role: string; content: string }> = []
): InteractionAgentRuntime {
  const runtime = new InteractionAgentRuntime(
    conversationId,
    userId,
    chatGuid,
    context,
    conversationHistory
  );
  setInteractionAgentRuntime(runtime);
  return runtime;
}
