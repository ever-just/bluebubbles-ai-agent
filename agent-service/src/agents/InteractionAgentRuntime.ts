import Anthropic from '@anthropic-ai/sdk';
import { InteractionAgent, createInteractionAgent, INTERACTION_AGENT_TOOLS } from './InteractionAgent';
import { ExecutionBatchManager, createExecutionBatchManager } from './ExecutionBatchManager';
import { iMessageAdapter, getIMessageAdapter } from './iMessageAdapter';
import { ToolExecutionContext } from '../tools/Tool';
import { logInfo, logError, logDebug, logWarn } from '../utils/logger';
import { config } from '../config';
import { getActionAcknowledgment, detectActionType, looksLikeSearchQuery, ActionType } from '../utils/actionAcknowledgments';
import { formatSearchResults } from '../utils/messageFormatting';
import { getAnthropicRequestManager } from '../services/AnthropicRequestManager';

const MAX_TOOL_ITERATIONS = 8;

/**
 * Build server-side tool definitions (web_search, web_fetch) if enabled.
 */
function buildServerTools(): Array<{ type: string; name: string; max_uses?: number }> {
  const tools: Array<{ type: string; name: string; max_uses?: number }> = [];
  const model = config.anthropic.model || 'claude-sonnet-4-20250514';
  
  // Check if model supports web search
  const supportsWebSearch = [
    'claude-3-5-haiku', 'claude-haiku-4-5', 'claude-sonnet-4-5',
    'claude-sonnet-4', 'claude-3-7-sonnet', 'claude-opus-4-1', 'claude-opus-4'
  ].some(pattern => model.includes(pattern));
  
  if (config.anthropic.enableWebSearch && supportsWebSearch) {
    tools.push({
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: config.anthropic.webSearchMaxUses ?? 5
    });
  }
  
  return tools;
}

/**
 * Strip citation markup from web search responses.
 * Removes <cite index="...">...</cite> tags, keeping only the text content.
 */
function stripCitations(text: string): string {
  // Remove <cite index="...">...</cite> tags, keeping inner text
  return text.replace(/<cite[^>]*>(.*?)<\/cite>/gi, '$1').trim();
}

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
  private requestManager = getAnthropicRequestManager();
  private batchManager: ExecutionBatchManager;
  private iMessageAdapter: iMessageAdapter;
  private context: ToolExecutionContext;
  private chatGuid: string;
  private lastUserMessageGuid: string;
  private lastUserMessageText: string;  // Store text for debugging reaction targets
  private conversationHistory: Array<{ role: string; content: string }>;

  constructor(
    conversationId: string,
    userId: string,
    chatGuid: string,
    context: ToolExecutionContext,
    conversationHistory: Array<{ role: string; content: string }> = [],
    lastUserMessageGuid: string = '',
    lastUserMessageText: string = ''  // Store text for debugging reaction targets
  ) {
    this.agent = createInteractionAgent(conversationId, userId);
    this.context = context;
    this.chatGuid = chatGuid;
    this.lastUserMessageGuid = lastUserMessageGuid;
    this.lastUserMessageText = lastUserMessageText;
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
    let hasAcknowledged = false;

    // PRE-EMPTIVE ACKNOWLEDGMENT: For user messages that look like search queries,
    // send acknowledgment BEFORE Claude API call (since web_search is a server tool)
    // Skip for tapback reactions (e.g., "Liked "what's the weather?"") - they contain quoted text that may match
    // Note: iMessage uses curly quotes (" " U+201C U+201D) not straight quotes (")
    // Also handles emoji format: "Reacted 😂 to "message text""
    const isTapbackReaction = /^(Liked|Loved|Disliked|Laughed at|Emphasized|Questioned)\s+["\u201C\u201D]/i.test(content)
      || /^Reacted\s+.+\s+to\s+["\u201C\u201D]/i.test(content);
    const looksLikeSearch = looksLikeSearchQuery(content);
    logInfo('Pre-emptive ack check', { 
      content: content.substring(0, 50), 
      isTapbackReaction, 
      looksLikeSearch,
      messageType 
    });
    if (messageType === 'user' && looksLikeSearch && !hasAcknowledged && !isTapbackReaction) {
      const ack = getActionAcknowledgment('web_search');
      await this.iMessageAdapter.sendToUser(ack, this.chatGuid, true);
      messagesSent.push(ack);
      hasAcknowledged = true;
      logInfo('Pre-emptive search acknowledgment sent', { ack });
    }

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

        // Build tools array with both interaction tools and server-side tools
        const serverTools = buildServerTools();
        const allTools = [
          ...INTERACTION_AGENT_TOOLS,
          ...serverTools
        ];
        
        // Call Claude with interaction tools + server-side tools (web_search)
        // Use requestManager to emit typing indicator events
        // Only pass chatGuid on FIRST iteration to avoid restarting typing on tool follow-ups
        const response = await this.requestManager.execute(
          () => this.anthropic.messages.create({
            model: config.anthropic.model || 'claude-sonnet-4-20250514',
            max_tokens: config.anthropic.responseMaxTokens || 1024,
            system: systemPrompt,
            tools: allTools as any,
            messages
          }),
          {
            description: iterationCount === 1 ? 'interaction-agent-claude' : 'interaction-agent-tool-followup',
            estimatedInputTokens: 1000,
            estimatedOutputTokens: config.anthropic.responseMaxTokens || 1024,
            chatGuid: iterationCount === 1 ? this.chatGuid : undefined // Only start typing on first call
          }
        );

        // Log all content block types for debugging
        logDebug('Response content blocks', {
          types: response.content.map((b: any) => b.type),
          stopReason: response.stop_reason
        });
        
        // Check for server tool use (web_search) - these are executed by Anthropic
        const serverToolBlocks = response.content.filter(
          (block: any) => block.type === 'server_tool_use'
        );
        
        // Check for client tool use (our custom tools)
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        );
        
        // If web_search server tool was used and we haven't acknowledged yet, do so now
        // (This is a fallback - pre-emptive detection should catch most cases)
        const hasWebSearch = serverToolBlocks.some((block: any) => block.name === 'web_search');
        if (hasWebSearch && !hasAcknowledged) {
          const ack = getActionAcknowledgment('web_search');
          logInfo('Web search server tool detected - sending fallback acknowledgment', { ack });
          await this.iMessageAdapter.sendToUser(ack, this.chatGuid, true);
          messagesSent.push(ack);
          hasAcknowledged = true;
        }

        // If no client tool use, check for text content to send
        if (toolUseBlocks.length === 0) {
          // Extract any text blocks from the response
          const textBlocks = response.content.filter(
            (block): block is Anthropic.TextBlock => block.type === 'text'
          );
          
          // If Claude returned text without using send_message_to_user tool, send it anyway
          if (textBlocks.length > 0) {
            const textContent = textBlocks.map(b => b.text).join('\n').trim();
            if (textContent) {
              logInfo('Claude returned text without tool - sending directly', {
                textPreview: textContent.substring(0, 50)
              });
              // Strip citations and format for better iMessage display
              let cleanMessage = stripCitations(textContent);
              cleanMessage = formatSearchResults(cleanMessage);
              await this.iMessageAdapter.sendToUser(cleanMessage, this.chatGuid, true);
              messagesSent.push(cleanMessage);
            }
          }
          
          logInfo('InteractionAgentRuntime completed (no more tools)', {
            iterationCount,
            messagesSent: messagesSent.length,
            agentsSpawned: agentsSpawned.length,
            hadServerTools: serverToolBlocks.length > 0
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
                // Send message via iMessage (skipTyping=true because MessageRouter manages typing)
                // Strip any citation markup from web search responses
                const cleanMessage = stripCitations(data.message);
                await this.iMessageAdapter.sendToUser(cleanMessage, this.chatGuid, true);
                messagesSent.push(cleanMessage);
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: `Message sent to user: "${data.message.substring(0, 50)}..."`
                });
                break;

              case 'send_to_agent':
                // Send acknowledgment BEFORE spawning agent (if not already sent)
                if (!hasAcknowledged) {
                  const ack = getActionAcknowledgment('spawn_agent');
                  await this.iMessageAdapter.sendToUser(ack, this.chatGuid, true);
                  messagesSent.push(ack);
                  hasAcknowledged = true;
                  logInfo('Agent spawn acknowledgment sent', { ack, agentName: data.agentName });
                }
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
                logInfo('Agent used wait tool', {
                  reason: data.reason,
                  chatGuid: this.chatGuid,
                  lastUserMessage: this.lastUserMessageText?.substring(0, 50)
                });
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: `Waiting: ${data.reason}`
                });
                break;

              case 'react_to_message':
                // Send tapback reaction via iMessage
                try {
                  if (this.lastUserMessageGuid) {
                    logInfo('Sending reaction to user message', {
                      chatGuid: this.chatGuid,
                      targetMessageGuid: this.lastUserMessageGuid,
                      targetMessageText: this.lastUserMessageText?.substring(0, 50) || '[unknown]',
                      reaction: data.reaction
                    });
                    await this.iMessageAdapter.sendReaction(
                      this.chatGuid,
                      this.lastUserMessageGuid,
                      data.reaction
                    );
                    toolResults.push({
                      type: 'tool_result',
                      tool_use_id: toolUse.id,
                      content: `Reaction "${data.reaction}" sent to message`
                    });
                  } else {
                    logWarn('Cannot send reaction - no message GUID available');
                    toolResults.push({
                      type: 'tool_result',
                      tool_use_id: toolUse.id,
                      content: `Could not send reaction - no message GUID available`
                    });
                  }
                } catch (error) {
                  logError('Failed to send reaction', error);
                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: toolUse.id,
                    content: `Failed to send reaction: ${error instanceof Error ? error.message : 'Unknown error'}`
                  });
                }
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
  conversationHistory: Array<{ role: string; content: string }> = [],
  lastUserMessageGuid: string = '',
  lastUserMessageText: string = ''  // Store text for debugging reaction targets
): InteractionAgentRuntime {
  const runtime = new InteractionAgentRuntime(
    conversationId,
    userId,
    chatGuid,
    context,
    conversationHistory,
    lastUserMessageGuid,
    lastUserMessageText
  );
  setInteractionAgentRuntime(runtime);
  return runtime;
}
