# Project Structure & Repository Organization

## 📁 Current Structure

All documentation is in **one main folder**: `/Users/cloudaistudio/CascadeProjects/bluebubbles-ai-agent/`

```
bluebubbles-ai-agent/               # Main project folder (all docs here)
├── 📚 Documentation/
│   ├── README.md                   # Project overview
│   ├── COMPLEXITY-ANALYSIS.md      # Complexity breakdown
│   ├── PROJECT-STRUCTURE.md        # This file
│   ├── research-plan.md           # Research objectives
│   ├── findings/                   # Research findings
│   │   ├── bluebubbles-analysis.md
│   │   ├── claude-sdk-analysis.md
│   │   ├── integration-architecture.md
│   │   ├── context-persistence.md
│   │   ├── google-integration.md
│   │   ├── oauth-implementation.md
│   │   └── proactive-messaging.md
│   ├── architecture/              # Architecture designs
│   │   ├── system-design.md
│   │   └── backend-hosting-analysis.md
│   └── implementation-plan/       # Implementation details
│       ├── roadmap.md
│       └── tech-stack.md
│
├── 🔧 Your Forked Repos (separate folders)/
│   ├── bluebubbles-server/       # Your fork of BlueBubbles Server
│   └── bluebubbles-app/          # Your fork of BlueBubbles App
│
└── 💻 Agent Code (to be created)/
    ├── agent-service/             # Main AI agent service
    ├── message-router/            # Channel routing service
    └── shared-libs/               # Shared utilities
```

## 🔄 Setting Up Your Forks

### Step 1: Clone your forks into the project
```bash
cd /Users/cloudaistudio/CascadeProjects/bluebubbles-ai-agent

# Clone your BlueBubbles Server fork
git clone https://github.com/ever-just/bluebubbles-server.git

# Clone your BlueBubbles App fork
git clone https://github.com/ever-just/bluebubbles-app.git

# Add upstream remotes to pull updates from original repos
cd bluebubbles-server
git remote add upstream https://github.com/BlueBubblesApp/BlueBubbles-Server.git
git remote -v  # Verify remotes

cd ../bluebubbles-app
git remote add upstream https://github.com/BlueBubblesApp/bluebubbles-app.git
git remote -v  # Verify remotes
cd ..
```

### Step 2: Create the agent service folder
```bash
# Create your custom agent service (this is YOUR code, not a fork)
mkdir -p agent-service
cd agent-service
npm init -y
npm install @anthropic-ai/claude-agent-sdk socket.io-client express
```

## 📂 Three Separate Code Repositories

### 1️⃣ **bluebubbles-server/** (Forked)
- **Purpose**: Modified BlueBubbles Server with webhook support
- **Your changes**: 
  - Add webhook events for AI agent
  - Custom message handlers
  - Enhanced API endpoints
- **Git remote**: 
  - `origin`: your fork (ever-just/bluebubbles-server)
  - `upstream`: original (BlueBubblesApp/BlueBubbles-Server)

### 2️⃣ **bluebubbles-app/** (Forked)
- **Purpose**: Modified BlueBubbles client (if needed)
- **Your changes**: Minimal or none initially
- **Git remote**:
  - `origin`: your fork (ever-just/bluebubbles-app)
  - `upstream`: original (BlueBubblesApp/bluebubbles-app)

### 3️⃣ **agent-service/** (Your New Code)
- **Purpose**: Your AI agent implementation
- **Contains**:
  - Claude SDK integration
  - Message router
  - OAuth implementation
  - Context management
  - Proactive scheduler
- **Git remote**: Your own new repository

## 🛠️ Working with Multiple Repos

### Development Workflow
```bash
# Working on BlueBubbles Server modifications
cd bluebubbles-server
git checkout -b feature/agent-webhooks
# Make your changes
git add .
git commit -m "Add webhook support for AI agent"
git push origin feature/agent-webhooks

# Working on your agent service
cd ../agent-service
git init
git add .
git commit -m "Initial agent service setup"
# Create new repo on GitHub, then:
git remote add origin https://github.com/ever-just/bluebubbles-ai-agent.git
git push -u origin main
```

### Keeping Forks Updated
```bash
# Update your fork with upstream changes
cd bluebubbles-server
git fetch upstream
git checkout main
git merge upstream/main
git push origin main
```

## 🏗️ Recommended Folder Organization

```bash
# Final structure
bluebubbles-ai-agent/
├── README.md                      # Main documentation
├── docs/                          # All research/architecture docs
│   ├── findings/
│   ├── architecture/
│   └── implementation-plan/
├── bluebubbles-server/           # Forked & modified
├── bluebubbles-app/              # Forked (maybe modified)
├── agent-service/                # Your main code
│   ├── src/
│   │   ├── services/
│   │   │   ├── AgentService.ts
│   │   │   ├── MessageRouter.ts
│   │   │   └── ContextManager.ts
│   │   ├── integrations/
│   │   │   ├── BlueBubblesClient.ts
│   │   │   └── GmailClient.ts
│   │   └── index.ts
│   ├── package.json
│   └── docker-compose.yml
└── deployment/                    # Deployment configs
    ├── docker/
    └── kubernetes/
```

## 🔗 Connecting the Pieces

### How the repos work together:
1. **bluebubbles-server** runs on your Mac
2. **agent-service** runs on DigitalOcean (or locally for dev)
3. They communicate via Socket.io/REST API

### Connection Example:
```typescript
// In agent-service/src/integrations/BlueBubblesClient.ts
import io from 'socket.io-client';

class BlueBubblesClient {
  connect() {
    // Connects to your modified bluebubbles-server
    this.socket = io('http://your-mac-ip:1234', {
      auth: { password: 'your-password' }
    });
    
    // Listen for messages from bluebubbles-server
    this.socket.on('new-message', this.handleMessage);
  }
}
```

## 📝 Next Steps

1. **Clone your forks** (commands above)
2. **Move docs to subdirectory** (optional, for cleaner organization)
3. **Create agent-service folder** for your custom code
4. **Set up git for agent-service** as a new repository
5. **Start development** with BlueBubbles Server locally

## 💡 Pro Tips

### Keep Repos Separate Because:
- **bluebubbles-server**: Minimal changes, easy to pull upstream updates
- **agent-service**: Your custom code, complete control
- **Clean separation**: Easy to debug and maintain

### Use Workspace (Optional):
```json
// package.json in root folder
{
  "name": "bluebubbles-ai-workspace",
  "private": true,
  "workspaces": [
    "agent-service",
    "bluebubbles-server/packages/server"
  ]
}
```

This allows `npm install` at root to install all dependencies!
