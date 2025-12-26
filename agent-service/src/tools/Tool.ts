import { PermissionLevel, getSecurityManager } from '../middleware/security';

/**
 * Definition describing a tool for Claude's tool calling API.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * Result returned by tools.
 */
export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Context provided to a tool when it is executed.
 */
export interface ToolExecutionContext {
  userHandle: string;
  userId: string;
  conversationId: string;
  isAdmin: boolean;
  runtimeContext?: any; // Prompt runtime context for enhanced tool execution
  chatGuid?: string; // BlueBubbles chat GUID for typing indicators
}

export interface ITool {
  getDefinition(): ToolDefinition;
  execute(input: any, context: ToolExecutionContext): Promise<ToolResult>;
  getRequiredPermission(): PermissionLevel;
}

/**
 * Base convenience class for implementing tools.
 */
export abstract class BaseTool implements ITool {
  abstract getDefinition(): ToolDefinition;
  abstract execute(input: any, context: ToolExecutionContext): Promise<ToolResult>;

  getRequiredPermission(): PermissionLevel {
    return PermissionLevel.USER;
  }

  protected success<T = any>(data: T): ToolResult {
    return { success: true, data };
  }

  protected error(message: string): ToolResult {
    return { success: false, error: message };
  }
}

export const ensureToolPermissions = (tool: ITool, context: ToolExecutionContext): boolean => {
  const securityManager = getSecurityManager();
  const required = tool.getRequiredPermission();
  return securityManager.hasPermission(context.userHandle, required);
};
