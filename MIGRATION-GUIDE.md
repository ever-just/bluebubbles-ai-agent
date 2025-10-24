# Migration Guide: Moving to a New Mac

> **Context**: This project was initially developed on a MacBook with limited storage. We're now migrating to a Mac Mini for production deployment.

## 📋 Why We're Migrating

**Original Setup (MacBook)**
- ❌ Insufficient storage for full development environment
- ❌ Not suitable for 24/7 server operation
- ✅ Used for initial development and testing

**New Setup (Mac Mini)**
- ✅ Adequate storage for all dependencies
- ✅ Can run 24/7 as iMessage server
- ✅ Better suited for production deployment
- ✅ Direct iMessage access (critical for BlueBubbles)

## 🎯 What Needs to Be Done

### Phase 1: Install Development Tools
### Phase 2: Clone Repository
### Phase 3: Install Dependencies
### Phase 4: Configure Services
### Phase 5: Verify Everything Works

---

## Phase 1: Install Development Tools

### 1.1 Check What's Already Installed

Run these commands to see what you already have:

```bash
# Check Homebrew
which brew
brew --version

# Check Git
which git
git --version

# Check Node.js
which node
node --version

# Check npm
which npm
npm --version

# Check Docker
which docker
docker --version

# Check GitHub CLI
which gh
gh --version
```

### 1.2 Install Missing Tools

**If Homebrew is NOT installed:**
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Follow the instructions to add Homebrew to your PATH
# Usually something like:
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

**If Git is NOT installed:**
```bash
brew install git
```

**If Node.js is NOT installed (or version < 18):**
```bash
# Install Node.js v18 or later
brew install node

# Verify version
node --version  # Should be v18.x.x or higher
```

**If Docker Desktop is NOT installed:**
```bash
# Install Docker Desktop
brew install --cask docker

# Open Docker Desktop from Applications folder
# Wait for it to fully start (whale icon in menu bar should be steady)
```

**If GitHub CLI is NOT installed:**
```bash
brew install gh
```

### 1.3 Configure Git (if first time)

```bash
# Set your name and email
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"

# Verify
git config --list
```

---

## Phase 2: Clone Repository

### 2.1 Authenticate with GitHub

```bash
# Login to GitHub
gh auth login

# Follow prompts:
# 1. Choose: GitHub.com
# 2. Choose: HTTPS
# 3. Choose: Yes (authenticate Git)
# 4. Choose: Login with a web browser
# 5. Copy the code, press Enter, paste in browser
```

### 2.2 Clone the Repository

```bash
# Navigate to where you want the project
cd ~/Documents  # or ~/Developer, or wherever you prefer

# Clone the repository
git clone https://github.com/ever-just/bluebubbles-ai-agent.git

# Navigate into the project
cd bluebubbles-ai-agent

# Verify the clone
ls -la
```

You should see:
- `agent-service/` - Main application
- `bluebubbles-app/` - Flutter mobile app
- `bluebubbles-server/` - BlueBubbles server
- `README.md`, `architecture/`, `deployment/`, etc.

---

## Phase 3: Install Dependencies

### 3.1 Install Agent Service Dependencies

```bash
cd agent-service

# Install all npm packages
npm install

# This will install:
# - @anthropic-ai/sdk
# - express, cors, body-parser
# - typeorm, pg, redis, ioredis
# - socket.io-client
# - bull, chrono-node
# - typescript, ts-node, nodemon
# - and all other dependencies

# Wait for installation to complete (may take 2-5 minutes)
```

### 3.2 Verify Installation

```bash
# Check that node_modules exists
ls -la node_modules

# Check package versions
npm list --depth=0
```

---

## Phase 4: Configure Services

### 4.1 Set Up Environment Variables

```bash
# Still in agent-service directory
cp .env.example .env

# Edit the .env file
nano .env  # or use VS Code: code .env
```

**Required Configuration:**

```env
# Anthropic AI - GET FROM: https://console.anthropic.com/
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxxxxxxxxxx

# BlueBubbles - Configure after installing BlueBubbles Server
BLUEBUBBLES_URL=http://localhost:1234
BLUEBUBBLES_PASSWORD=your_secure_password_here

# Database - Default values work for local Docker setup
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=bluebubbles_ai
DATABASE_USER=postgres
DATABASE_PASSWORD=postgres

# Redis - Default values work for local Docker setup
REDIS_HOST=localhost
REDIS_PORT=6379

# Server
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
```

**Save and exit** (Ctrl+X, then Y, then Enter in nano)

### 4.2 Start Docker Services

```bash
# Make sure Docker Desktop is running first!
# Check the menu bar for the whale icon

# Start PostgreSQL and Redis
docker-compose up -d postgres redis

# Verify they're running
docker-compose ps

# You should see:
# NAME                    STATUS
# agent-service-postgres  Up
# agent-service-redis     Up

# Check logs if needed
docker-compose logs postgres
docker-compose logs redis
```

### 4.3 Install BlueBubbles Server (Mac Mini Specific)

**Option A: Download Pre-built App (Recommended)**
```bash
# Download from GitHub releases
open https://github.com/BlueBubblesApp/bluebubbles-server/releases

# Download the latest .dmg file
# Install like any Mac app
# Configure with your iMessage account
```

**Option B: Run from Source (Advanced)**
```bash
# Navigate to the included server
cd ../bluebubbles-server

# Install dependencies
npm install

# Start the server
npm start
```

**Configure BlueBubbles Server:**
1. Open the BlueBubbles Server app
2. Complete the setup wizard
3. Set a secure password (use this in your .env file)
4. Enable "Private API" if you want advanced features
5. Note the server URL (usually http://localhost:1234)

### 4.4 Grant Mac Permissions

BlueBubbles needs special permissions on macOS:

```bash
# System Settings → Privacy & Security → Full Disk Access
# Add: Terminal (if running from terminal)
# Add: BlueBubbles Server app

# System Settings → Privacy & Security → Accessibility
# Add: BlueBubbles Server app
```

---

## Phase 5: Verify Everything Works

### 5.1 Test Database Connection

```bash
# In agent-service directory
docker exec -it agent-service-postgres psql -U postgres -d bluebubbles_ai

# You should see a PostgreSQL prompt
# Type \dt to see tables (will be empty initially)
# Type \q to exit
```

### 5.2 Test Redis Connection

```bash
docker exec -it agent-service-redis redis-cli

# You should see a Redis prompt
# Type PING (should respond with PONG)
# Type exit to quit
```

### 5.3 Start the Agent Service

```bash
# In agent-service directory
npm run dev

# Watch for these success messages:
# ✓ Database connected
# ✓ Redis connected
# ✓ BlueBubbles client connected
# ✓ Server running on port 3000
```

### 5.4 Test the API

Open a new terminal window:

```bash
# Test health endpoint
curl http://localhost:3000/health

# Should return: {"status":"ok"}

# Test status endpoint
curl http://localhost:3000/status

# Should return detailed system status
```

### 5.5 Test iMessage Integration

1. Send a message to your iMessage account from another device
2. Check the agent-service logs
3. You should see:
   - "Received message from [phone number]"
   - "Processing with Claude..."
   - "Response sent"

---

## 🔍 Troubleshooting

### Problem: "Docker daemon not running"
**Solution:**
```bash
# Open Docker Desktop from Applications
# Wait for it to fully start (whale icon steady in menu bar)
# Try docker-compose up again
```

### Problem: "Port 5432 already in use"
**Solution:**
```bash
# Check what's using the port
lsof -i :5432

# If it's another PostgreSQL instance, stop it:
brew services stop postgresql
# OR
sudo pkill -u postgres
```

### Problem: "Cannot connect to BlueBubbles"
**Solution:**
1. Verify BlueBubbles Server is running
2. Check the URL in .env matches the server
3. Verify the password is correct
4. Check firewall settings

### Problem: "ANTHROPIC_API_KEY invalid"
**Solution:**
1. Go to https://console.anthropic.com/
2. Create a new API key
3. Copy the FULL key (starts with sk-ant-api03-)
4. Update .env file
5. Restart the service

### Problem: "Module not found" errors
**Solution:**
```bash
# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Problem: Database tables not created
**Solution:**
```bash
# Recreate the database
docker-compose down
docker-compose up -d postgres redis

# Wait 5 seconds, then start the app
npm run dev
```

---

## 📊 Checklist: Is Everything Working?

Use this checklist to verify your setup:

- [ ] Homebrew installed and updated
- [ ] Git installed and configured
- [ ] Node.js v18+ installed
- [ ] Docker Desktop installed and running
- [ ] GitHub CLI installed and authenticated
- [ ] Repository cloned successfully
- [ ] npm dependencies installed
- [ ] .env file created and configured
- [ ] PostgreSQL container running
- [ ] Redis container running
- [ ] BlueBubbles Server installed and configured
- [ ] Mac permissions granted (Full Disk Access, Accessibility)
- [ ] Agent service starts without errors
- [ ] Health endpoint responds
- [ ] iMessage messages are received and processed

---

## 🎯 What's Different on the New Mac?

### Old Mac (Development)
- Limited storage
- Used for coding and testing
- Not running 24/7
- No iMessage integration (testing only)

### New Mac Mini (Production)
- ✅ Full storage capacity
- ✅ Runs 24/7
- ✅ Direct iMessage access
- ✅ Production environment
- ✅ All services containerized
- ✅ Ready for real-world use

---

## 🚀 Next Steps After Migration

Once everything is verified:

1. **Test thoroughly** - Send various messages, set reminders
2. **Monitor logs** - Watch for any errors or issues
3. **Configure autostart** - Set services to start on boot
4. **Set up backups** - Regular database backups
5. **Consider deployment** - Move to cloud if needed (see deployment/)

---

## 📝 Notes

- Keep the old Mac setup until new Mac is fully verified
- Document any Mac Mini-specific configurations
- Update .env with production values when ready
- Consider using a process manager (PM2) for production
- Set up monitoring and alerting

---

## 🆘 Need Help?

If you encounter issues:
1. Check the logs: `docker-compose logs -f`
2. Check agent service logs in the terminal
3. Review this guide's troubleshooting section
4. Check GitHub issues: https://github.com/ever-just/bluebubbles-ai-agent/issues

---

**Last Updated**: October 2024  
**Migration Status**: In Progress  
**Target Device**: Mac Mini (Production)
