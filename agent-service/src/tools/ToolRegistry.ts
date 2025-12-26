import { logInfo, logWarn, logError } from '../utils/logger';
import { ensureToolPermissions, ITool, ToolDefinition, ToolExecutionContext, ToolResult } from './Tool';
import { createReminderTool, listRemindersTool, cancelReminderTool } from './ReminderTool';
import { createTriggerTool, listTriggersTool, updateTriggerTool, deleteTriggerTool } from './TriggerTool';
import { sendEmailTool, listEmailsTool, readEmailTool, replyEmailTool, getAgentEmailTool } from './EmailTool';
import { config } from '../config';

/**
 * Registry for managing AI tools.
 * Registers built-in tools (reminders) and allows additional tools to be added.
 */
export class ToolRegistry {
  private tools = new Map<string, ITool>();

  constructor() {
    // Register built-in tools
    this.registerBuiltInTools();
    
    logInfo('Tool registry initialized', {
      toolCount: this.tools.size,
      tools: Array.from(this.tools.keys())
    });
  }

  private registerBuiltInTools(): void {
    // Reminder tools
    this.tools.set(createReminderTool.getDefinition().name, createReminderTool);
    this.tools.set(listRemindersTool.getDefinition().name, listRemindersTool);
    this.tools.set(cancelReminderTool.getDefinition().name, cancelReminderTool);

    // Trigger tools
    this.tools.set(createTriggerTool.getDefinition().name, createTriggerTool);
    this.tools.set(listTriggersTool.getDefinition().name, listTriggersTool);
    this.tools.set(updateTriggerTool.getDefinition().name, updateTriggerTool);
    this.tools.set(deleteTriggerTool.getDefinition().name, deleteTriggerTool);

    // Email tools (only if AgentMail is enabled)
    if (config.agentmail.enabled) {
      this.tools.set(sendEmailTool.getDefinition().name, sendEmailTool);
      this.tools.set(listEmailsTool.getDefinition().name, listEmailsTool);
      this.tools.set(readEmailTool.getDefinition().name, readEmailTool);
      this.tools.set(replyEmailTool.getDefinition().name, replyEmailTool);
      this.tools.set(getAgentEmailTool.getDefinition().name, getAgentEmailTool);
    }
  }

  registerTool(tool: ITool): void {
    const definition = tool.getDefinition();
    this.tools.set(definition.name, tool);
    logInfo('Tool registered', { name: definition.name });
  }

  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(tool => tool.getDefinition());
  }

  async executeTool(toolName: string, input: any, context: ToolExecutionContext): Promise<ToolResult> {
    const tool = this.tools.get(toolName);

    if (!tool) {
      logWarn('Tool not found', { toolName });
      return {
        success: false,
        error: `Tool '${toolName}' not found`
      };
    }

    if (!ensureToolPermissions(tool, context)) {
      logWarn('Tool execution denied - insufficient permissions', {
        toolName,
        userHandle: context.userHandle
      });

      return {
        success: false,
        error: `Insufficient permissions to use tool '${toolName}'`
      };
    }

    try {
      logInfo('Executing tool', { toolName, user: context.userHandle });
      const result = await tool.execute(input, context);
      logInfo('Tool execution completed', {
        toolName,
        success: result.success
      });
      return result;
    } catch (error: any) {
      logError('Tool execution failed', error, { toolName });
      return {
        success: false,
        error: `Tool execution failed: ${error.message ?? 'Unknown error'}`
      };
    }
  }

  getTool(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }
}

let registryInstance: ToolRegistry | null = null;

export const getToolRegistry = (): ToolRegistry => {
  if (!registryInstance) {
    registryInstance = new ToolRegistry();
  }

  return registryInstance;
};
