import Anthropic from '@anthropic-ai/sdk';
import { ExecutionAgent, getAgentRoster } from './ExecutionAgent';
import { getToolRegistry } from '../tools/ToolRegistry';
import { ToolExecutionContext } from '../tools/Tool';
import { logInfo, logError, logDebug, logWarn } from '../utils/logger';
import { config } from '../config';

const MAX_TOOL_ITERATIONS = 8;

/**
 * Result from execution agent runtime.
 */
export interface ExecutionResult {
  agentName: string;
  success: boolean;
  response: string;
  toolsUsed: string[];
  iterationCount: number;
  error?: string;
}

/**
 * ExecutionAgentRuntime manages the LLM loop for a single execution agent request.
 */
export class ExecutionAgentRuntime {
  private agent: ExecutionAgent;
  private anthropic: Anthropic;
  private toolRegistry = getToolRegistry();
  private context: ToolExecutionContext;

  constructor(agentName: string, context: ToolExecutionContext) {
    const roster = getAgentRoster();
    const { agent } = roster.getOrCreateAgent(agentName);
    this.agent = agent;
    this.context = context;
    this.anthropic = new Anthropic({
      apiKey: config.anthropic.apiKey
    });
  }

  /**
   * Execute instructions and return the result.
   */
  async execute(instructions: string): Promise<ExecutionResult> {
    const toolsUsed: string[] = [];
    let iterationCount = 0;

    // Record the request
    this.agent.recordRequest(instructions);

    // Build initial messages
    const systemPrompt = this.agent.buildSystemPromptWithHistory();
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: instructions }
    ];

    logInfo('ExecutionAgentRuntime starting execution', {
      agentName: this.agent.name,
      instructionsPreview: instructions.substring(0, 100)
    });

    try {
      // Tool execution loop
      while (iterationCount < MAX_TOOL_ITERATIONS) {
        iterationCount++;

        logDebug('ExecutionAgentRuntime iteration', {
          agentName: this.agent.name,
          iteration: iterationCount
        });

        // Call Claude
        const response = await this.anthropic.messages.create({
          model: config.anthropic.model || 'claude-sonnet-4-20250514',
          max_tokens: config.anthropic.responseMaxTokens || 1024,
          system: systemPrompt,
          tools: this.toolRegistry.getToolDefinitions() as any,
          messages
        });

        // Check for tool use
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        );

        // If no tool use, we have a final response
        if (toolUseBlocks.length === 0) {
          const textBlocks = response.content.filter(
            (block): block is Anthropic.TextBlock => block.type === 'text'
          );
          const finalResponse = textBlocks.map(b => b.text).join('\n');
          
          this.agent.recordResponse(finalResponse);
          
          logInfo('ExecutionAgentRuntime completed', {
            agentName: this.agent.name,
            iterationCount,
            toolsUsed
          });

          return {
            agentName: this.agent.name,
            success: true,
            response: finalResponse,
            toolsUsed,
            iterationCount
          };
        }

        // Process tool calls
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolUse of toolUseBlocks) {
          const toolName = toolUse.name;
          const toolInput = toolUse.input as Record<string, any>;

          logDebug('ExecutionAgentRuntime executing tool', {
            agentName: this.agent.name,
            toolName,
            input: toolInput
          });

          toolsUsed.push(toolName);

          // Execute the tool
          const result = await this.toolRegistry.executeTool(
            toolName,
            toolInput,
            this.context
          );

          // Record the execution
          this.agent.recordToolExecution(
            toolName,
            toolInput,
            result.success ? JSON.stringify(result.data) : (result.error || 'Unknown error')
          );

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: result.success
              ? JSON.stringify(result.data)
              : `Error: ${result.error}`
          });
        }

        // Add assistant response and tool results to messages
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });
      }

      // Max iterations reached
      logWarn('ExecutionAgentRuntime max iterations reached', {
        agentName: this.agent.name,
        maxIterations: MAX_TOOL_ITERATIONS
      });

      return {
        agentName: this.agent.name,
        success: false,
        response: `Execution stopped after ${MAX_TOOL_ITERATIONS} iterations without completing.`,
        toolsUsed,
        iterationCount,
        error: 'Max iterations reached'
      };

    } catch (error: any) {
      logError('ExecutionAgentRuntime execution failed', error);

      return {
        agentName: this.agent.name,
        success: false,
        response: `Execution failed: ${error.message || 'Unknown error'}`,
        toolsUsed,
        iterationCount,
        error: error.message
      };
    }
  }
}

/**
 * Factory function to create an execution agent runtime.
 */
export function createExecutionAgentRuntime(
  agentName: string,
  context: ToolExecutionContext
): ExecutionAgentRuntime {
  return new ExecutionAgentRuntime(agentName, context);
}
