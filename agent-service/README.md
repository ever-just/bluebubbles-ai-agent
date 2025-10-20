# BlueBubbles AI Agent Service

This is the core AI agent service that powers the BlueBubbles AI Assistant, integrating with iMessage through BlueBubbles and email through Gmail API.

## Prerequisites

- Node.js v18+ and npm
- Docker Desktop (for PostgreSQL and Redis)
- BlueBubbles Server running on macOS
- Google Cloud account with Gmail API enabled
- Anthropic API key for Claude

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and update with your values:

```bash
cp .env.example .env
```

Required configurations:
- `ANTHROPIC_API_KEY`: Your Claude API key from Anthropic
- `BLUEBUBBLES_URL`: URL to your BlueBubbles server
- `BLUEBUBBLES_PASSWORD`: Your BlueBubbles password
- `GOOGLE_CLIENT_ID`: From Google Cloud Console
- `GOOGLE_CLIENT_SECRET`: From Google Cloud Console
- `ENCRYPTION_KEY`: Generate with `openssl rand -hex 32`
- `SESSION_SECRET`: Generate with `openssl rand -base64 32`

### 3. Start Docker Services

First, ensure Docker Desktop is running, then:

```bash
# Start PostgreSQL and Redis
docker-compose up -d postgres redis

# Verify services are running
docker-compose ps

# View logs if needed
docker-compose logs -f postgres redis
```

### 4. Run Database Migrations

The database schema will be automatically created from `init.sql` when the PostgreSQL container starts.

### 5. Start the Agent Service

```bash
# Development mode with hot reload
npm run dev

# Production mode
npm run build
npm start
```

## Development Commands

```bash
# Run tests
npm test

# Lint code
npm run lint

# Build for production
npm run build

# Start with debug tools (pgAdmin and Redis Commander)
docker-compose --profile debug up -d
```

## Service URLs

When running locally:
- **Agent Service**: http://localhost:3000
- **pgAdmin** (debug profile): http://localhost:5050
  - Email: admin@bluebubbles.local
  - Password: admin
- **Redis Commander** (debug profile): http://localhost:8081

## Project Structure

```
agent-service/
├── src/
│   ├── index.ts           # Main application entry
│   ├── auth/              # OAuth and authentication
│   ├── integrations/      # BlueBubbles & Gmail integrations
│   ├── services/          # Core services (AI, context, etc.)
│   └── utils/             # Utility functions
├── tests/                 # Test files
├── docker-compose.yml     # Docker services configuration
├── init.sql              # Database schema
├── package.json          # Node dependencies
└── tsconfig.json         # TypeScript configuration
```

## API Endpoints

- `POST /webhook/bluebubbles` - Receive messages from BlueBubbles
- `POST /webhook/gmail` - Receive Gmail notifications
- `GET /auth/google` - Initiate Google OAuth flow
- `GET /auth/google/callback` - Google OAuth callback
- `GET /health` - Health check endpoint

## Troubleshooting

### Docker Issues
- Ensure Docker Desktop is running
- Check ports 5432 (PostgreSQL) and 6379 (Redis) are available
- Use `docker-compose logs` to view container logs

### Database Connection Issues
- Verify DATABASE_URL in .env matches docker-compose.yml
- Check PostgreSQL container is healthy: `docker-compose ps`
- Manually connect: `psql postgresql://postgres:password@localhost:5432/bluebubbles_agent`

### BlueBubbles Connection Issues
- Verify BlueBubbles Server is running
- Check BLUEBUBBLES_URL and BLUEBUBBLES_PASSWORD
- Test connection: `curl http://localhost:1234/api/v1/chat`

## Next Steps

1. Configure BlueBubbles webhooks to point to this service
2. Set up Google OAuth credentials in Google Cloud Console
3. Configure Gmail push notifications
4. Deploy to DigitalOcean or your preferred cloud provider
