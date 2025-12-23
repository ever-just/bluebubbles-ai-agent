import { readFileSync } from 'fs';
import { join } from 'path';
import { logInfo, logError, logDebug } from '../utils/logger';
import { ToolDefinition } from '../tools/Tool';
import { getToolRegistry } from '../tools/ToolRegistry';
import { getExecutionAgentLogStore } from './ExecutionAgentLogStore';

// Load system prompt from markdown file
const PROMPT_PATH = join(__dirname, 'prompts/execution_system_prompt.md');
let EXECUTION_SYSTEM_PROMPT: string;
try {
  EXECUTION_SYSTEM_PROMPT = readFileSync(PROMPT_PATH, 'utf-8');
} catch (error) {
  logError('Failed to load execution system prompt, using fallback', error);
  EXECUTION_SYSTEM_PROMPT = 'You are an execution agent. Complete the assigned task using available tools.';
}

/**
 * Execution history entry for persistent agent memory.
 */
export interface ExecutionHistoryEntry {
  entryType: 'request' | 'action' | 'tool_response' | 'response';
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

/**
 * ExecutionAgent handles task-specific execution with persistent memory.
 * Each agent has a name and maintains execution history across requests.
 */
export class ExecutionAgent {
  public readonly name: string;
  private executionHistory: ExecutionHistoryEntry[] = [];
  private toolRegistry = getToolRegistry();

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Build system prompt with agent's execution history injected.
   */
  buildSystemPromptWithHistory(): string {
    const basePrompt = EXECUTION_SYSTEM_PROMPT;
    
    if (this.executionHistory.length === 0) {
      return basePrompt;
    }

    const historySection = `
## Previous Actions for This Agent

You have previously worked on tasks under this agent name. Here is your execution history:

${this.executionHistory.map(entry => {
  const timestamp = entry.timestamp.toISOString();
  return `- [${entry.entryType.toUpperCase()}] (${timestamp}) ${entry.content.substring(0, 200)}${entry.content.length > 200 ? '...' : ''}`;
}).join('\n')}

Use this context to inform your current task.
`;

    return basePrompt + '\n' + historySection;
  }

  /**
   * Get tool definitions available to this execution agent.
   * Currently returns all registered tools.
   */
  getToolDefinitions(): ToolDefinition[] {
    return this.toolRegistry.getToolDefinitions();
  }

  /**
   * Record a request received by this agent.
   */
  async recordRequest(instructions: string): Promise<void> {
    const entry: ExecutionHistoryEntry = {
      entryType: 'request',
      content: instructions,
      timestamp: new Date()
    };
    this.executionHistory.push(entry);
    
    // Persist to database
    const logStore = getExecutionAgentLogStore();
    await logStore.saveEntry(this.name, entry);
    
    logDebug('ExecutionAgent recorded request', { agentName: this.name });
  }

  /**
   * Record a tool execution (action).
   */
  async recordToolExecution(toolName: string, args: Record<string, any>, result: string): Promise<void> {
    const content = `Tool: ${toolName}, Args: ${JSON.stringify(args)}, Result: ${result}`;
    const entry: ExecutionHistoryEntry = {
      entryType: 'action',
      content,
      timestamp: new Date(),
      metadata: { toolName, args }
    };
    this.executionHistory.push(entry);
    
    // Persist to database
    const logStore = getExecutionAgentLogStore();
    await logStore.saveEntry(this.name, entry);
    
    logDebug('ExecutionAgent recorded tool execution', { agentName: this.name, toolName });
  }

  /**
   * Record a tool response.
   */
  recordToolResponse(toolName: string, response: string): void {
    this.executionHistory.push({
      entryType: 'tool_response',
      content: `${toolName}: ${response}`,
      timestamp: new Date(),
      metadata: { toolName }
    });
  }

  /**
   * Record the final response from this agent.
   */
  async recordResponse(response: string): Promise<void> {
    const entry: ExecutionHistoryEntry = {
      entryType: 'response',
      content: response,
      timestamp: new Date()
    };
    this.executionHistory.push(entry);
    
    // Persist to database
    const logStore = getExecutionAgentLogStore();
    await logStore.saveEntry(this.name, entry);
    
    logDebug('ExecutionAgent recorded response', { agentName: this.name });
  }

  /**
   * Get execution history for this agent.
   */
  getExecutionHistory(): ExecutionHistoryEntry[] {
    return [...this.executionHistory];
  }

  /**
   * Load execution history from database.
   */
  async loadHistoryFromDatabase(): Promise<void> {
    const logStore = getExecutionAgentLogStore();
    const history = await logStore.loadHistory(this.name);
    this.executionHistory = history;
    logInfo('ExecutionAgent loaded history from database', { 
      agentName: this.name, 
      entryCount: history.length 
    });
  }

  /**
   * Load execution history from external source.
   */
  loadHistory(history: ExecutionHistoryEntry[]): void {
    this.executionHistory = history;
    logInfo('ExecutionAgent loaded history', { 
      agentName: this.name, 
      entryCount: history.length 
    });
  }

  /**
   * Clear execution history.
   */
  clearHistory(): void {
    this.executionHistory = [];
    logDebug('ExecutionAgent cleared history', { agentName: this.name });
  }
}

/**
 * AgentRoster tracks active execution agents for reuse.
 */
export class AgentRoster {
  private agents: Map<string, ExecutionAgent> = new Map();

  /**
   * Get or create an execution agent by name.
   */
  getOrCreateAgent(name: string): { agent: ExecutionAgent; isNew: boolean } {
    const existing = this.agents.get(name);
    if (existing) {
      logDebug('AgentRoster reusing existing agent', { name });
      return { agent: existing, isNew: false };
    }

    const newAgent = new ExecutionAgent(name);
    this.agents.set(name, newAgent);
    logInfo('AgentRoster created new agent', { name });
    return { agent: newAgent, isNew: true };
  }

  /**
   * Get all agent names in the roster.
   */
  getAgentNames(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * Check if an agent exists.
   */
  hasAgent(name: string): boolean {
    return this.agents.has(name);
  }

  /**
   * Get an agent by name (returns undefined if not found).
   */
  getAgent(name: string): ExecutionAgent | undefined {
    return this.agents.get(name);
  }

  /**
   * Remove an agent from the roster.
   */
  removeAgent(name: string): boolean {
    return this.agents.delete(name);
  }

  /**
   * Get count of agents in roster.
   */
  get size(): number {
    return this.agents.size;
  }
}

// Singleton roster instance
let rosterInstance: AgentRoster | null = null;

export function getAgentRoster(): AgentRoster {
  if (!rosterInstance) {
    rosterInstance = new AgentRoster();
  }
  return rosterInstance;
}
