import { logInfo, logWarn, logError } from '../utils/logger';
import { ensureToolPermissions, ITool, ToolDefinition, ToolExecutionContext, ToolResult } from './Tool';

/**
 * Registry for managing AI tools. Currently initializes without any built-in tools
 * so that the agent can run even when optional integrations are not configured.
 */
export class ToolRegistry {
  private tools = new Map<string, ITool>();

  constructor() {
    logInfo('Tool registry initialized', {
      toolCount: this.tools.size
    });
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
