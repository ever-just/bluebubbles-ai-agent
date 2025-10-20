# Technology Stack Recommendations

## Overview
Comprehensive technology stack selection for building a production-ready AI assistant with iMessage and email integration.

## Core Technologies

### Programming Language: TypeScript
**Reasoning:**
- Strong typing for better code reliability
- Excellent tooling and IDE support
- Native compatibility with Claude Agent SDK
- Large ecosystem of libraries
- Easy integration with Node.js runtime

**Alternative Considered:** Python
- Pros: Good for ML/AI tasks, simpler syntax
- Cons: Less performant for real-time messaging, weaker typing

### Runtime: Node.js 18+ LTS
**Reasoning:**
- Event-driven architecture perfect for messaging
- Non-blocking I/O for handling concurrent connections
- Native WebSocket support
- Large package ecosystem (npm)
- Good performance for I/O-bound operations

### Framework: Express.js + Socket.io
**Reasoning:**
- Express: Minimal, flexible web framework
- Socket.io: Real-time bidirectional communication
- Battle-tested in production
- Excellent documentation and community

**Alternative Considered:** Fastify
- Pros: Better performance, schema validation
- Cons: Smaller ecosystem, less BlueBubbles compatibility

## AI/ML Stack

### AI Agent: Claude Agent SDK
**Version:** Latest (@anthropic-ai/claude-agent-sdk)
**Reasoning:**
- Purpose-built for agent development
- Built-in context management
- Tool calling capabilities
- Streaming support
- Official Anthropic support

### Model: Claude 3 Opus
**Reasoning:**
- Best performance for complex tasks
- Large context window (200K tokens)
- Excellent instruction following
- Strong reasoning capabilities

**Fallback:** Claude 3 Sonnet for cost optimization

### Embeddings: OpenAI text-embedding-3-small
**Reasoning:**
- Cost-effective
- Good performance for semantic search
- Easy integration
- Well-documented API

## Data Layer

### Primary Database: PostgreSQL 15
**Reasoning:**
- ACID compliance for data integrity
- JSONB support for flexible schemas
- Full-text search capabilities
- Excellent performance with proper indexing
- Vector extension (pgvector) for embeddings

```sql
-- Example: Install pgvector extension
CREATE EXTENSION vector;

-- Create embeddings column
ALTER TABLE memories ADD COLUMN embedding vector(1536);
```

### Cache Layer: Redis 7
**Reasoning:**
- In-memory performance
- Pub/Sub for real-time updates
- TTL support for automatic cleanup
- Cluster support for scaling
- Bull queue backend

**Configuration:**
```redis
# Redis configuration
maxmemory 2gb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
appendonly yes
```

### Vector Database: Pinecone (Optional)
**Reasoning:**
- Managed service, no maintenance
- Fast similarity search
- Scalable to millions of vectors
- Good for long-term memory

**Alternative:** pgvector (PostgreSQL extension)
- Pros: No additional service, lower cost
- Cons: Less specialized, requires tuning

## Message Queue

### Queue System: Bull (Redis-based)
**Reasoning:**
- Reliable job processing
- Retry mechanisms built-in
- Priority queues
- Delayed jobs support
- Dashboard for monitoring

**Configuration:**
```typescript
const queueConfig = {
  redis: {
    host: 'localhost',
    port: 6379,
    maxRetriesPerRequest: 3
  },
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: false,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  }
};
```

## Authentication & Security

### Authentication: Auth0
**Reasoning:**
- Managed authentication service
- Social login support (Google)
- MFA support
- JWT token management
- RBAC capabilities

**Configuration:**
```typescript
const auth0Config = {
  domain: process.env.AUTH0_DOMAIN,
  clientId: process.env.AUTH0_CLIENT_ID,
  clientSecret: process.env.AUTH0_CLIENT_SECRET,
  audience: process.env.AUTH0_AUDIENCE,
  scope: 'openid profile email'
};
```

### Secret Management: AWS Secrets Manager / HashiCorp Vault
**Reasoning:**
- Centralized secret storage
- Automatic rotation
- Audit logging
- Fine-grained access control

## External Integrations

### Email: Gmail API
**Reasoning:**
- Official Google API
- Push notifications support
- Thread management
- Rich formatting support

**Libraries:**
```json
{
  "googleapis": "^118.0.0",
  "google-auth-library": "^8.7.0"
}
```

### Calendar: Google Calendar API
**Reasoning:**
- Seamless Gmail integration
- Real-time updates
- Recurring events support
- Free tier sufficient for MVP

### iMessage: BlueBubbles Server
**Reasoning:**
- Most mature solution
- Active development
- Socket.io based (easy integration)
- Good documentation

## Infrastructure

### Container: Docker
**Base Image:** node:18-alpine
**Reasoning:**
- Small image size
- Security focused
- Consistent environments
- Easy deployment

**Dockerfile:**
```dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:18-alpine
RUN apk add --no-cache dumb-init
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --chown=node:node . .
USER node
EXPOSE 3000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
```

### Orchestration: Kubernetes / Docker Compose
**Development:** Docker Compose
```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:3000"
    depends_on:
      - postgres
      - redis
    environment:
      - NODE_ENV=development
  
  postgres:
    image: postgres:15
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=bluebubbles
      - POSTGRES_PASSWORD=secret
  
  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

**Production:** Kubernetes
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agent-service
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: agent
        image: bluebubbles-agent:latest
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
```

## Monitoring & Observability

### Metrics: Prometheus + Grafana
**Reasoning:**
- Industry standard
- Pull-based metrics
- Powerful query language
- Beautiful dashboards

**Metrics to Track:**
```typescript
// Custom metrics
const messageCounter = new Counter({
  name: 'messages_processed_total',
  help: 'Total messages processed',
  labelNames: ['channel', 'status']
});

const responseTime = new Histogram({
  name: 'response_time_seconds',
  help: 'Response time in seconds',
  buckets: [0.1, 0.5, 1, 2, 5]
});
```

### Logging: Winston + ELK Stack
**Reasoning:**
- Structured logging
- Multiple transports
- Log aggregation
- Powerful search

**Configuration:**
```typescript
const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'agent-service' },
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    }),
    new winston.transports.File({ 
      filename: 'error.log', 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: 'combined.log' 
    })
  ]
});
```

### Error Tracking: Sentry
**Reasoning:**
- Real-time error tracking
- Performance monitoring
- Release tracking
- User feedback

## Development Tools

### Testing Framework: Jest + Supertest
**Reasoning:**
- Fast test execution
- Great mocking capabilities
- Snapshot testing
- Code coverage built-in

**Example Test:**
```typescript
describe('AgentService', () => {
  let service: AgentService;
  
  beforeEach(() => {
    service = new AgentService();
  });
  
  test('should process message', async () => {
    const response = await service.processMessage(
      'user123',
      'Hello',
      mockContext
    );
    expect(response).toBeDefined();
    expect(response.content).toContain('Hello');
  });
});
```

### Code Quality: ESLint + Prettier
**Configuration:**
```json
{
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier"
  ],
  "rules": {
    "no-console": "warn",
    "@typescript-eslint/no-unused-vars": "error"
  }
}
```

### CI/CD: GitHub Actions
**Reasoning:**
- Native GitHub integration
- Free for public repos
- Matrix testing support
- Easy secret management

**Workflow:**
```yaml
name: CI/CD
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
      redis:
        image: redis:7
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm test
      - run: npm run build
```

## Package Dependencies

### Core Dependencies
```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "latest",
    "express": "^4.18.2",
    "socket.io": "^4.5.4",
    "socket.io-client": "^4.5.4",
    "typeorm": "^0.3.17",
    "pg": "^8.11.3",
    "redis": "^4.6.10",
    "bull": "^4.11.4",
    "googleapis": "^126.0.1",
    "auth0": "^3.7.2",
    "winston": "^3.11.0",
    "dotenv": "^16.3.1",
    "joi": "^17.11.0",
    "axios": "^1.6.2",
    "node-cron": "^3.0.3",
    "uuid": "^9.0.1"
  }
}
```

### Development Dependencies
```json
{
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.10",
    "typescript": "^5.3.2",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.1",
    "supertest": "^6.3.3",
    "eslint": "^8.54.0",
    "@typescript-eslint/eslint-plugin": "^6.13.1",
    "@typescript-eslint/parser": "^6.13.1",
    "prettier": "^3.1.0",
    "nodemon": "^3.0.2",
    "ts-node": "^10.9.1"
  }
}
```

## Performance Optimization

### Caching Strategy
1. **L1 Cache**: In-process memory (LRU)
2. **L2 Cache**: Redis
3. **L3 Cache**: PostgreSQL materialized views

### Database Optimization
```sql
-- Indexes for common queries
CREATE INDEX idx_conversations_user_created 
  ON conversations(user_id, created_at DESC);
  
CREATE INDEX idx_messages_channel_time 
  ON messages(channel, created_at DESC);

-- Partitioning for large tables
CREATE TABLE conversations_2024_01 
  PARTITION OF conversations 
  FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
```

### Connection Pooling
```typescript
const pgPool = new Pool({
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

const redisPool = createPool({
  min: 2,
  max: 10,
});
```

## Security Best Practices

### Environment Variables
```bash
# .env.example
NODE_ENV=production
PORT=3000

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/db
REDIS_URL=redis://localhost:6379

# APIs
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# BlueBubbles
BLUEBUBBLES_URL=http://localhost:1234
BLUEBUBBLES_PASSWORD=...

# Auth0
AUTH0_DOMAIN=...
AUTH0_CLIENT_ID=...
AUTH0_CLIENT_SECRET=...

# Encryption
ENCRYPTION_KEY=...
JWT_SECRET=...
```

### Security Headers
```typescript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));
```

## Cost Analysis

### Monthly Cost Estimate
| Service | Usage | Cost |
|---------|-------|------|
| Claude API | 1M tokens/day | $200-500 |
| PostgreSQL (RDS) | db.t3.medium | $50 |
| Redis (ElastiCache) | cache.t3.micro | $25 |
| EC2/ECS | t3.medium x2 | $80 |
| Load Balancer | ALB | $25 |
| Storage (S3) | 100GB | $5 |
| Monitoring | CloudWatch | $20 |
| **Total** | | **$405-705** |

### Cost Optimization Strategies
1. Use Claude Sonnet for non-critical tasks
2. Implement aggressive caching
3. Use spot instances for workers
4. Compress message history
5. Archive old conversations to S3

## Migration Strategy

### From Development to Production
1. **Database Migration**
   ```bash
   pg_dump dev_db | psql prod_db
   ```

2. **Configuration Migration**
   - Use environment-specific configs
   - Separate secrets per environment
   - Feature flags for gradual rollout

3. **Data Migration**
   - Implement versioned migrations
   - Test with production-like data
   - Have rollback procedures

## Vendor Lock-in Mitigation

### Abstraction Layers
```typescript
// Abstract interfaces for swappable implementations
interface MessageChannel {
  send(message: Message): Promise<void>;
  receive(): AsyncIterator<Message>;
}

interface AIProvider {
  complete(prompt: string): Promise<string>;
  stream(prompt: string): AsyncIterator<string>;
}

interface Database {
  query<T>(sql: string, params?: any[]): Promise<T>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
```

This allows switching providers without major code changes.
