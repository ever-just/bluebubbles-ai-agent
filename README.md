# BlueBubbles AI Agent

> **Status**: ✅ **FULLY IMPLEMENTED & PRODUCTION-READY**

An intelligent AI assistant that integrates with iMessage through BlueBubbles, powered by Claude 3 Opus, with persistent context memory and proactive messaging capabilities.

## 🎯 What's Been Built

This is a **complete, working system** - not a research project. All core features are implemented and tested:

### ✅ Completed Features
- **Real-time iMessage Integration** - Socket.io connection to BlueBubbles Server
- **AI-Powered Responses** - Claude 3 Opus with streaming support
- **Three-Tier Memory System** - Working, session, and long-term context persistence
- **Natural Language Reminders** - Parse and schedule reminders with Bull queue
- **Proactive Messaging** - Send scheduled messages and notifications
- **RESTful API** - Full CRUD operations for conversations, messages, reminders
- **Database Layer** - PostgreSQL with TypeORM entities
- **Redis Caching** - Fast context retrieval and job queuing
- **Docker Setup** - Containerized PostgreSQL and Redis
- **Graceful Shutdown** - Proper cleanup of connections and resources

## 📁 Project Structure

```
/bluebubbles-ai-agent/
├── agent-service/              # Main application (IMPLEMENTED)
│   ├── src/
│   │   ├── config/            # Configuration management
│   │   ├── database/          # TypeORM entities & connection
│   │   ├── integrations/      # BlueBubblesClient (Socket.io)
│   │   ├── services/          # Core business logic
│   │   │   ├── ClaudeService.ts      # AI integration
│   │   │   ├── ContextService.ts     # Memory management
│   │   │   ├── MessageRouter.ts      # Message handling
│   │   │   └── ReminderService.ts    # Scheduled tasks
│   │   ├── types/             # TypeScript definitions
│   │   ├── utils/             # Logger & utilities
│   │   └── index.ts           # Express server entry point
│   ├── docker-compose.yml     # PostgreSQL + Redis setup
│   ├── init.sql               # Database schema
│   ├── .env.example           # Environment template
│   └── package.json           # Dependencies
├── bluebubbles-app/           # Flutter mobile app (included)
├── bluebubbles-server/        # Node.js server (included)
├── architecture/              # Design documentation
├── deployment/                # Deployment guides
└── findings/                  # Research notes
```

## 🏗️ System Architecture

### Implemented Components

**1. BlueBubblesClient** (`src/integrations/BlueBubblesClient.ts`)
- Socket.io real-time connection to BlueBubbles Server
- Automatic reconnection with exponential backoff
- Message sending and receiving
- Typing indicators and read receipts

**2. ClaudeService** (`src/services/ClaudeService.ts`)
- Anthropic API integration with Claude 3 Opus
- Streaming response support
- Action extraction from AI responses
- Error handling and retry logic

**3. ContextService** (`src/services/ContextService.ts`)
- **Working Memory**: Current conversation context
- **Session Memory**: Recent conversation history (24h)
- **Long-term Memory**: Important facts and preferences
- Automatic context pruning and token management
- Vector embeddings for semantic search (ready for implementation)

**4. MessageRouter** (`src/services/MessageRouter.ts`)
- Incoming message processing
- Conversation management
- Context assembly and AI invocation
- Response delivery
- Action execution (reminders, etc.)

**5. ReminderService** (`src/services/ReminderService.ts`)
- Natural language parsing with chrono-node
- Bull queue for reliable scheduling
- Proactive message delivery
- Recurring reminder support

**6. Express API Server** (`src/index.ts`)
- RESTful endpoints for all entities
- Health checks and status monitoring
- Webhook support for external integrations
- Graceful shutdown handling

## 🚀 Quick Start - Running the System

### Prerequisites
- **macOS** with iMessage configured
- **Node.js** v18+ installed
- **Docker Desktop** running
- **Anthropic API Key** from https://console.anthropic.com/
- **BlueBubbles Server** configured and running

### Installation Steps

**1. Clone the Repository**
```bash
git clone https://github.com/ever-just/bluebubbles-ai-agent.git
cd bluebubbles-ai-agent/agent-service
```

**2. Install Dependencies**
```bash
npm install
```

**3. Configure Environment**
```bash
cp .env.example .env
# Edit .env and add your credentials:
nano .env
```

Required environment variables:
```env
# Anthropic AI
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# BlueBubbles
BLUEBUBBLES_URL=http://localhost:1234  # Your BlueBubbles server URL
BLUEBUBBLES_PASSWORD=your_bluebubbles_password

# Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=bluebubbles_ai
DATABASE_USER=postgres
DATABASE_PASSWORD=postgres

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Server
PORT=3000
NODE_ENV=development
```

**4. Start Docker Services**
```bash
# Start PostgreSQL and Redis
docker-compose up -d postgres redis

# Verify they're running
docker-compose ps
```

**5. Run the Application**
```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm run build
npm start
```

### Verification

The server should start and show:
```
✓ Database connected
✓ Redis connected
✓ BlueBubbles client connected
✓ Server running on port 3000
```

Test the API:
```bash
curl http://localhost:3000/health
```

### Technology Stack (Implemented)
- **Language**: TypeScript/Node.js
- **AI**: Anthropic Claude 3 Opus
- **Database**: PostgreSQL with TypeORM
- **Cache/Queue**: Redis + Bull
- **Real-time**: Socket.io (BlueBubbles)
- **API**: Express.js
- **Parsing**: chrono-node (natural language dates)

## 📊 Database Schema

The system uses 7 TypeORM entities:

1. **User** - User accounts and preferences
2. **Conversation** - Chat threads with metadata
3. **Message** - Individual messages with AI responses
4. **ContextMemory** - Three-tier memory system
5. **Reminder** - Scheduled proactive messages
6. **CalendarEvent** - Calendar integration (ready for implementation)
7. **OAuthToken** - OAuth tokens (ready for Google integration)

Schema is automatically created from `init.sql` on first run.

## 🔌 API Endpoints

### Health & Status
- `GET /health` - Server health check
- `GET /status` - Detailed system status

### Conversations
- `GET /conversations` - List all conversations
- `GET /conversations/:id` - Get conversation details
- `POST /conversations` - Create new conversation
- `PUT /conversations/:id` - Update conversation
- `DELETE /conversations/:id` - Delete conversation

### Messages
- `GET /messages` - List all messages
- `GET /messages/:id` - Get message details
- `POST /messages` - Send new message
- `GET /conversations/:id/messages` - Get conversation messages

### Reminders
- `GET /reminders` - List all reminders
- `GET /reminders/:id` - Get reminder details
- `POST /reminders` - Create reminder
- `PUT /reminders/:id` - Update reminder
- `DELETE /reminders/:id` - Delete reminder

### Context Memory
- `GET /context/:conversationId` - Get conversation context
- `POST /context` - Add context memory
- `DELETE /context/:id` - Delete context memory

## 🎯 What's Working Right Now

✅ **Send a message via iMessage** → AI responds with context awareness  
✅ **Set a reminder** → "Remind me to call mom tomorrow at 3pm"  
✅ **Maintain context** → AI remembers previous conversation  
✅ **Proactive messaging** → Scheduled reminders are delivered  
✅ **API access** → Full CRUD operations via REST  
✅ **Graceful shutdown** → Clean resource cleanup  

## 🚧 Future Enhancements (Not Yet Implemented)

- ❌ **Gmail Integration** - Email channel support
- ❌ **Google Calendar** - Calendar event management
- ❌ **OAuth Flow** - Google authentication
- ❌ **Vector Embeddings** - Semantic memory search
- ❌ **Multi-user Support** - User authentication system
- ❌ **Web Dashboard** - Admin UI for monitoring

## 🔧 Development & Deployment

### Local Development
```bash
# Watch mode with auto-reload
npm run dev

# Check logs
docker-compose logs -f postgres redis

# Database migrations (if needed)
npm run migration:run
```

### Production Deployment

The system is ready for deployment to:
- **DigitalOcean Droplet** (recommended)
- **AWS EC2**
- **Any VPS with Docker support**

See `deployment/` folder for detailed guides.

### Environment Variables

Critical variables to set:
- `ANTHROPIC_API_KEY` - Your Claude API key
- `BLUEBUBBLES_URL` - BlueBubbles server endpoint
- `BLUEBUBBLES_PASSWORD` - BlueBubbles auth password
- `DATABASE_*` - PostgreSQL connection details
- `REDIS_*` - Redis connection details

## 💰 Estimated Operating Costs

### Monthly (Production)
- **Claude API**: $50-200 (depends on usage)
- **DigitalOcean Droplet**: $12-24 (2-4GB RAM)
- **Managed PostgreSQL**: $15 (optional, can use Docker)
- **Managed Redis**: $10 (optional, can use Docker)
- **Total**: ~$87-250/month

### Development (Local)
- **Free** - Everything runs locally via Docker

## 📚 Additional Documentation

- `architecture/system-design.md` - Detailed architecture
- `deployment/digitalocean-setup.md` - Deployment guide
- `findings/` - Research notes and analysis
- `QUICK-START.md` - Condensed setup guide

## 🔒 Security Notes

- Environment variables contain sensitive keys - never commit `.env`
- PostgreSQL and Redis should be firewalled in production
- Consider using managed database services for production
- BlueBubbles password should be strong and unique
- API endpoints should be rate-limited in production

## 📝 License

MIT License - See LICENSE file for details

## 🙏 Acknowledgments

Built with:
- [BlueBubbles](https://bluebubbles.app/) - iMessage integration
- [Anthropic Claude](https://www.anthropic.com/) - AI capabilities
- [TypeORM](https://typeorm.io/) - Database ORM
- [Bull](https://github.com/OptimalBits/bull) - Job queue

## ✨ Summary

This is a **fully functional, production-ready** AI assistant that:
- ✅ **Integrates with iMessage** via BlueBubbles
- ✅ **Maintains conversation context** across sessions
- ✅ **Schedules proactive reminders** with natural language
- ✅ **Provides RESTful API** for external integrations
- ✅ **Runs reliably** with Docker containerization

**The system is ready to deploy and use!** 🚀

---

**Repository**: https://github.com/ever-just/bluebubbles-ai-agent  
**Status**: Production-Ready  
**Last Updated**: October 2024
