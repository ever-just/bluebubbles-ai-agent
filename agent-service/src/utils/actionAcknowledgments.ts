/**
 * Action Acknowledgment System
 * 
 * Provides natural language acknowledgments for various agent actions.
 * Used to give immediate feedback to users when actions take time.
 */

export type ActionType = 
  | 'web_search'
  | 'send_email'
  | 'create_reminder'
  | 'list_reminders'
  | 'create_trigger'
  | 'spawn_agent'
  | 'generic_tool';

const ACTION_ACKNOWLEDGMENTS: Record<ActionType, string[]> = {
  web_search: [
    "let me look that up",
    "searching for that now",
    "one sec, checking on that",
    "looking into it",
    "let me find out",
    "hold on, looking that up",
  ],
  send_email: [
    "sending that email now",
    "on it, drafting the email",
    "let me send that for you",
    "composing that email",
  ],
  create_reminder: [
    "setting that reminder",
    "got it, creating the reminder",
    "adding that to your reminders",
    "I'll remind you",
  ],
  list_reminders: [
    "let me check your reminders",
    "pulling up your reminders",
    "checking what you have scheduled",
  ],
  create_trigger: [
    "setting that up for you",
    "creating that automation",
    "got it, I'll handle that",
  ],
  spawn_agent: [
    "working on that",
    "let me handle that",
    "on it",
    "give me a moment",
    "working on it",
  ],
  generic_tool: [
    "working on it",
    "one moment",
    "let me take care of that",
    "on it",
  ],
};

/**
 * Get a random acknowledgment for the given action type.
 */
export function getActionAcknowledgment(actionType: ActionType): string {
  const options = ACTION_ACKNOWLEDGMENTS[actionType] || ACTION_ACKNOWLEDGMENTS.generic_tool;
  return options[Math.floor(Math.random() * options.length)];
}

/**
 * Map tool names to action types.
 */
export function detectActionType(toolName: string): ActionType {
  const toolToAction: Record<string, ActionType> = {
    'web_search': 'web_search',
    'send_email': 'send_email',
    'reply_email': 'send_email',
    'create_reminder': 'create_reminder',
    'list_reminders': 'list_reminders',
    'cancel_reminder': 'list_reminders',
    'create_trigger': 'create_trigger',
    'list_triggers': 'create_trigger',
    'update_trigger': 'create_trigger',
    'delete_trigger': 'create_trigger',
    'send_message_to_agent': 'spawn_agent',
  };
  return toolToAction[toolName] || 'generic_tool';
}

/**
 * Detect if a user message looks like a search query.
 * Used for pre-emptive acknowledgment before Claude API call.
 */
export function looksLikeSearchQuery(text: string): boolean {
  const searchPatterns = [
    // Question words with question mark
    /\b(what|who|when|where|how|why)\b.*\?/i,
    // Explicit search requests
    /\b(search|find|look up|google|check)\b/i,
    // Common search topics
    /\b(weather|news|price|stock|score|result)\b/i,
    // Event queries
    /\b(happening|events|playing|showing|performing)\b.*\b(today|tonight|tomorrow|this week)\b/i,
    // "What's" questions (common search pattern)
    /what'?s\s+(the|a|an)?\s*\w+/i,
  ];
  return searchPatterns.some(p => p.test(text));
}

/**
 * Detect if a user message looks like a reminder request.
 */
export function looksLikeReminderRequest(text: string): boolean {
  const reminderPatterns = [
    /\bremind\s+(me|us)\b/i,
    /\bset\s+(a\s+)?reminder\b/i,
    /\bdon'?t\s+let\s+me\s+forget\b/i,
  ];
  return reminderPatterns.some(p => p.test(text));
}

/**
 * Detect if a user message looks like an email request.
 */
export function looksLikeEmailRequest(text: string): boolean {
  const emailPatterns = [
    /\b(send|write|compose|draft)\s+(an?\s+)?email\b/i,
    /\bemail\s+(to|about)\b/i,
  ];
  return emailPatterns.some(p => p.test(text));
}

/**
 * Detect the likely action type from user message text.
 * Returns null if no specific action is detected.
 */
export function detectLikelyAction(text: string): ActionType | null {
  if (looksLikeSearchQuery(text)) return 'web_search';
  if (looksLikeReminderRequest(text)) return 'create_reminder';
  if (looksLikeEmailRequest(text)) return 'send_email';
  return null;
}
