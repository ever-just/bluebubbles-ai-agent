# TEXTMYAGENT

> **Mission:** Let anyone talk to an AI assistant over iMessage (or any texting app backed by BlueBubbles) without opening a browser or installing a new app.

TEXTMYAGENT turns everyday texting into an interface for a Claude-powered executive assistant. The service listens for inbound SMS/iMessage traffic through BlueBubbles, enriches conversations with long-term memory, and replies in real time while observing usage, rate limits, and context budgets.

## 🌟 Why This Exists

People already live in their messaging apps. TEXTMYAGENT keeps the AI assistant there, so users can:

1. Text the agent from their phone or laptop using native Messages or any BlueBubbles-compatible client.
2. Get intelligent, context-aware responses powered by Anthropic Claude.
3. Capture reminders, summaries, and follow-ups without switching tools.

The platform is built for founders and operators who want a dependable AI teammate that fits existing communication workflows.

## 🧠 Core Feature Set

| Capability | Description |
| --- | --- |
| **Text-based interface** | Two-way messaging over iMessage/SMS via BlueBubbles. |
| **Anthropic request manager** | Shared priority queue with rate limiting, backoff, and usage logging. |
| **Conversation memory** | Multi-layer memory (working/session/long-term) with automatic summarization to stay within token budgets. |
| **Tool execution** | Weather, reminders, email, calendar hooks, and easy extension points for more tools. |
| **Usage observability** | Structured logging, token accounting, and alerts when Anthropic quotas throttle traffic. |
| **Reminders & proactive outreach** | Natural language reminder parsing with reliable delivery through iMessage. |
| **Health monitoring** | Database/BlueBubbles readiness checks and graceful restarts. |

## 🏗️ Architecture Overview

```
TEXTMYAGENT
├── agent-service/                 # Node/TypeScript core
│   ├── src/config                 # Runtime configuration
│   ├── src/database               # TypeORM entities & migrations
│   ├── src/integrations           # BlueBubbles client, external APIs
│   ├── src/services               # Core orchestrators (Claude, context, reminders, notifications)
│   ├── src/tools                  # Tool registry & implementations
│   ├── src/utils                  # Logging, metrics, helpers
│   └── src/index.ts               # Express bootstrap & health endpoints
├── bluebubbles-app/               # Upstream BlueBubbles Flutter app (reference)
├── bluebubbles-server/            # BlueBubbles server fork for local/dev usage
├── architecture/                  # High-level design docs
├── deployment/                    # Deploy + infra runbooks
└── findings/                      # Research notes and integration analysis
```

Key services inside `agent-service`:

- **MessageRouter** – cleans inbound messages, assembles context (with summarization), coordinates Claude calls, and dispatches replies.
- **ClaudeServiceEnhanced** – wraps Anthropic Claude with streaming, tool loops, and the centralized request manager.
- **AnthropicRequestManager** – enforces rate limits, retry/backoff, and notifies admins if API quotas are exhausted.
- **ConversationSummarizer** – compresses history when token usage approaches configurable thresholds.
- **NotificationService** – escalates critical events (e.g., repeated 429s) via iMessage to admin phones.
- **ReminderService** – natural language parsing + Bull queue to deliver proactive messages.

## 🚀 Getting Started

### Prerequisites

- macOS host with iMessage signed in (required by BlueBubbles).
- Node.js 18+.
- Docker Desktop (for Postgres & Redis in development).
- Anthropic API key with Claude 3 access.
- Running BlueBubbles server.

### Setup

```bash
git clone https://github.com/ever-just/bluebubbles-ai-agent.git
cd bluebubbles-ai-agent/agent-service

npm install
cp .env.example .env
```

Update `.env` with:

- `ANTHROPIC_API_KEY` – Claude credential.
- `BLUEBUBBLES_URL` and `BLUEBUBBLES_PASSWORD` – connection to your BlueBubbles instance.
- `DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_KEY`, `SESSION_SECRET` – persistence and security settings.

Then start dependencies and the service:

```bash
docker-compose up -d postgres redis
npm run dev
# or npm run build && npm start for production mode
```

Successful startup shows logs confirming database, Redis, and BlueBubbles connections plus the Express server on port 3000.

## 🧾 Usage Flow

1. **Inbound message** reaches BlueBubbles → forwarded to TEXTMYAGENT.
2. **MessageRouter** persists the user message, builds context (summary + recent tail), and requests a Claude completion.
3. **AnthropicRequestManager** schedules the request respecting concurrency/token quotas, adding retries on 429 responses.
4. **ClaudeServiceEnhanced** executes tool calls if needed, collapses tool responses back into the chat, and returns a final message capped by `ANTHROPIC_RESPONSE_MAX_TOKENS`.
5. **BlueBubblesClient** sends the reply over iMessage/SMS.
6. **Notifications** fire if requests exhaust retries or other critical errors occur.

## ⚙️ Configuration Highlights

Environment variables (see `.env.example` for defaults):

| Key | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude authentication |
| `ANTHROPIC_MODEL` | Claude model (defaults to `claude-3-haiku-20240307`) |
| `ANTHROPIC_RESPONSE_MAX_TOKENS` | Hard cap on response token budget to control costs |
| `ANTHROPIC_MAX_CONCURRENT_REQUESTS` | Queue concurrency |
| `ANTHROPIC_SUMMARY_TRIGGER_TOKENS` | When to summarize conversation history |
| `BLUEBUBBLES_URL` / `BLUEBUBBLES_PASSWORD` | Messaging transport |
| `DATABASE_URL`, `REDIS_URL` | Persistence and job queue |
| `ENCRYPTION_KEY`, `SESSION_SECRET` | Secure storage and sessions |

## 📡 Features in Detail

### Conversation Intelligence
- **Automated summarization** keeps context manageable by trimming older turns and persisting a session memory snippet.
- **Token estimation & budgeting** guard against runaway Anthropic usage, especially on long chats.

### Reliability & Observability
- **Structured logging** with per-request metadata (tokens, queue length, retries) for debugging and cost tracking.
- **Admin alerts** sent via iMessage when Claude rate limits persist after retries.
- **Retry-after handling** respects Anthropic headers for smoother backoff.

### Extensibility
- Tool framework supports custom actions (e.g., CRM lookups, ticket creation).
- Reminder and notification pipelines can be extended to other channels (email, push) with minimal changes.

## 🛣️ Roadmap Ideas

- **Additional channels**: plug in WhatsApp, Telegram, Slack using similar transport bridges.
- **Knowledge retrieval**: vector search or RAG for richer answers.
- **User management**: multi-tenant controls, per-user memories, and billing hooks.
- **Analytics dashboard**: visualize usage, latency, and reminders in a web UI.
- **Automated tests**: expand integration coverage for BlueBubbles interactions.

## 📚 Supporting Docs

- `architecture/system-design.md` – in-depth diagrams and flow explanations.
- `deployment/` – scripts and runbooks for DigitalOcean and other infrastructure.
- `findings/` – research notes on integrations (Anthropic, Claude SDK, etc.).
- `MIGRATION-GUIDE.md` / `SETUP-CHECKLIST.md` – operational handoff references.

## 🔒 Security Practices

- `.env` is ignored by Git – keep API keys out of version control.
- Restrict database/Redis ports in production or use managed services.
- Rotate Claude and BlueBubbles credentials periodically.
- Enable rate limiting or auth for public-facing endpoints if exposing beyond trusted networks.

## 📝 License

MIT License – see `LICENSE` for details.

## 🙌 Credits

- [BlueBubbles](https://bluebubbles.app/) for the macOS-to-messaging bridge.
- [Anthropic Claude](https://www.anthropic.com/) for conversational intelligence.
- [TypeORM](https://typeorm.io/), [Bull](https://github.com/OptimalBits/bull), and the broader OSS ecosystem powering the stack.

---

**Repository:** https://github.com/ever-just/bluebubbles-ai-agent  
**Project Name:** TEXTMYAGENT  
**Last Updated:** November 2025
