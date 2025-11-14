# Prompt Design Research Notes

## Provider Guidance

### Anthropic (Claude)
- Emphasize **role prompting** via the system parameter; clearly define persona, allowed behaviors, and disallowed actions before any user content ([docs.claude.com](https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/system-prompts)).
- Keep instructions hierarchical: high-level charter → tone/behavior → task-specific rules. Claude respects the most recent, explicit constraints, so repeat key guardrails near the end of the prompt.

### Azure OpenAI / OpenAI
- Start prompts with a concise, direct instruction, then supply context/examples, and optionally restate the instruction at the end to counteract recency bias ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/concepts/prompt-engineering)).
- Use few-shot patterns (assistant/user exchanges) to prime the format of future turns; the model learns style and structure from these exemplars.
- Specify output schemas (lists, tables, JSON) inline to reduce variability.

## Community & Open Templates

### n8n AI Agent Templates
- Public n8n agents typically structure prompts as: **Identity → Mission → Capabilities/Tools → Output rules → Safety** (e.g., [AI Prompt Maker](https://n8n.io/workflows/5289-ai-prompt-maker/)).
- They explicitly call out available nodes/tools and how the agent should decide whether to invoke them, reinforcing tool-awareness and grounding.

### Leaked / Shared System Prompts
- Large collections of leaked prompts (e.g., [DEV post summarizing 6,500+ prompts](https://dev.to/itshayder/leaked-6500-secret-ai-system-prompts-from-top-companies-engineering-gold-revealed-on-github-42lj)) show common patterns:
  - Extremely detailed guardrails (brand voice, legal constraints, fallback language).
  - Clear escalation paths when data is missing: apologize, clarify, suggest next step.
  - Persistent insistence on truthfulness and referencing sources when possible.

## Key Takeaways for EverJust / Grace
1. **Generalize Identity**: Define Grace as the EverJust agent, then layer persona traits (tone, professionalism) separate from task-specific duties. This allows re-use across contexts beyond a single executive.
2. **Instruction Ordering**: Adopt the provider guidance—open with the mission charter, follow with behavioral/tone requirements, tool usage rules, safety boundaries, and repeat critical constraints at the end.
3. **Context Windows**: Combine structured runtime context (profile, memories, recent messages) with optional few-shot exemplars demonstrating preferred bubble formatting and multi-bubble plans.
4. **Tool Awareness**: Mirror n8n templates by documenting available integrations (BlueBubbles actions, future APIs) and decision criteria for invoking them.
5. **Safety & Transparency**: Borrow from leaked prompts—explicitly forbid fabrication, require acknowledgement when data is missing, and provide escalation language aligned with EverJust policy.

These insights will guide the upcoming revision of Grace's system prompt so it remains flexible, human-aligned, and effective across EverJust use cases.
