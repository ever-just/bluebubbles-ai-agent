# Mac Mini Setup Checklist

> **Quick reference guide for setting up the BlueBubbles AI Agent on a new Mac**

## ✅ Pre-Installation Checks

Run these commands to see what's already installed:

```bash
# Check all tools at once
echo "=== Homebrew ===" && which brew && brew --version
echo "=== Git ===" && which git && git --version
echo "=== Node.js ===" && which node && node --version
echo "=== npm ===" && which npm && npm --version
echo "=== Docker ===" && which docker && docker --version
echo "=== GitHub CLI ===" && which gh && gh --version
```

## 📦 Installation Steps

### Step 1: Install Homebrew (if needed)
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### Step 2: Install Required Tools
```bash
brew install git node gh
brew install --cask docker
```

### Step 3: Authenticate with GitHub
```bash
gh auth login
# Choose: GitHub.com → HTTPS → Yes → Login with browser
```

### Step 4: Clone Repository
```bash
cd ~/Documents
git clone https://github.com/ever-just/bluebubbles-ai-agent.git
cd bluebubbles-ai-agent/agent-service
```

### Step 5: Install Dependencies
```bash
npm install
```

### Step 6: Configure Environment
```bash
cp .env.example .env
nano .env  # Add your API keys and passwords
```

### Step 7: Start Docker Services
```bash
# Open Docker Desktop first!
docker-compose up -d postgres redis
docker-compose ps  # Verify running
```

### Step 8: Install BlueBubbles Server
- Download from: https://github.com/BlueBubblesApp/bluebubbles-server/releases
- Install and configure with iMessage
- Note the password for .env file

### Step 9: Grant Mac Permissions
- System Settings → Privacy & Security → Full Disk Access → Add Terminal & BlueBubbles
- System Settings → Privacy & Security → Accessibility → Add BlueBubbles

### Step 10: Start the Service
```bash
npm run dev
```

## ✅ Verification Checklist

- [ ] `curl http://localhost:3000/health` returns `{"status":"ok"}`
- [ ] Docker containers are running: `docker-compose ps`
- [ ] BlueBubbles Server is connected (check logs)
- [ ] Database tables created (check logs for "Database connected")
- [ ] Send test iMessage and receive AI response

## 🔑 Required Credentials

Make sure you have:
- [ ] Anthropic API Key (https://console.anthropic.com/)
- [ ] BlueBubbles Server password
- [ ] GitHub account authenticated

## 🚨 Common Issues

| Problem | Solution |
|---------|----------|
| Port 5432 in use | `brew services stop postgresql` |
| Docker not running | Open Docker Desktop from Applications |
| BlueBubbles won't connect | Check URL and password in .env |
| Module not found | `rm -rf node_modules && npm install` |

## 📊 Success Indicators

When everything is working, you should see:
```
✓ Database connected
✓ Redis connected
✓ BlueBubbles client connected
✓ Server running on port 3000
```

## 🎯 What Makes This Mac Different

**Why Mac Mini for Production:**
- ✅ Always-on server capability
- ✅ Direct iMessage access (critical)
- ✅ Sufficient storage for all dependencies
- ✅ Better performance for 24/7 operation

**Previous Mac (Development):**
- ❌ Limited storage
- ❌ Not suitable for 24/7 operation
- ✅ Used for initial development

---

**See MIGRATION-GUIDE.md for detailed instructions**
