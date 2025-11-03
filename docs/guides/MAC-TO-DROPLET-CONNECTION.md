# 🔌 Connecting Your Mac to DigitalOcean Droplet

Your Droplet: **104.248.178.178**

## The Challenge
- BlueBubbles Server **MUST** run on your Mac (iMessage access)
- Agent Service runs on DigitalOcean droplet
- They need to communicate securely

## Option 1: ngrok (Easiest - Start Here!)

### On Your Mac:
```bash
# 1. Install ngrok
brew install ngrok

# 2. Sign up for free account at ngrok.com
# 3. Get your auth token and configure
ngrok config add-authtoken YOUR_TOKEN

# 4. Start ngrok tunnel
ngrok http 1234

# You'll see something like:
# Forwarding: https://abc123def456.ngrok.io -> http://localhost:1234
```

### On Your Droplet:
```bash
# SSH into droplet
ssh root@104.248.178.178

# Edit production environment
su - bluebubbles
cd ~/agent/agent-service
nano .env

# Update these lines:
BLUEBUBBLES_URL=https://abc123def456.ngrok.io
BLUEBUBBLES_PASSWORD=your-bluebubbles-password

# Restart agent
pm2 restart agent
```

✅ **Pros**: Easy, works immediately, free tier available
❌ **Cons**: URL changes on restart (unless paid), slight latency

## Option 2: SSH Reverse Tunnel (Most Secure)

### On Your Mac:
```bash
# Create SSH key if you don't have one
ssh-keygen -t ed25519 -f ~/.ssh/bluebubbles_tunnel

# Copy key to droplet
ssh-copy-id -i ~/.ssh/bluebubbles_tunnel root@104.248.178.178

# Create reverse tunnel (keep this running!)
ssh -N -R 1234:localhost:1234 root@104.248.178.178 -i ~/.ssh/bluebubbles_tunnel

# Or run in background with autossh (install: brew install autossh)
autossh -M 0 -f -N -R 1234:localhost:1234 root@104.248.178.178 -i ~/.ssh/bluebubbles_tunnel
```

### On Your Droplet:
```bash
# The tunnel makes BlueBubbles available at localhost:1234
# Update .env:
BLUEBUBBLES_URL=http://localhost:1234
BLUEBUBBLES_PASSWORD=your-bluebubbles-password
```

✅ **Pros**: Most secure, no third-party service, free
❌ **Cons**: Need to maintain SSH connection

## Option 3: Tailscale VPN (Most Reliable)

### On Your Mac:
```bash
# Install Tailscale
brew install tailscale

# Start and authenticate
tailscale up

# Get your Tailscale IP
tailscale ip -4
# Example: 100.101.102.103
```

### On Your Droplet:
```bash
# Install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh

# Authenticate (follow the link)
tailscale up

# Update .env with Mac's Tailscale IP:
BLUEBUBBLES_URL=http://100.101.102.103:1234
BLUEBUBBLES_PASSWORD=your-bluebubbles-password
```

✅ **Pros**: Most reliable, survives network changes, secure
❌ **Cons**: Another service to manage (free for personal use)

## Option 4: Direct Connection (If You Have Static IP)

### On Your Mac:
```bash
# 1. Get your public IP
curl ifconfig.me

# 2. Configure router to forward port 1234 to your Mac
# 3. Configure Mac firewall to allow port 1234
```

### On Your Droplet:
```bash
# Update .env with your public IP:
BLUEBUBBLES_URL=http://YOUR_PUBLIC_IP:1234
BLUEBUBBLES_PASSWORD=your-bluebubbles-password
```

✅ **Pros**: Direct connection, no middleman
❌ **Cons**: Requires static IP, port forwarding, less secure

## 🧪 Testing the Connection

### From your Droplet:
```bash
# Test if BlueBubbles is reachable
curl YOUR_BLUEBUBBLES_URL

# Check agent service logs
pm2 logs agent

# Check if connected
curl http://localhost:3000/health
# Should show: "bluebubbles": true
```

### From your Browser:
```
http://104.248.178.178:3000/health
```

## 🚀 Quick Start Commands

### Complete Setup (Copy-Paste Ready)

#### Step 1: On Your Mac
```bash
# Using ngrok (recommended for testing)
brew install ngrok
ngrok http 1234
# Keep this terminal open!
```

#### Step 2: On Your Droplet
```bash
# SSH to droplet
ssh root@104.248.178.178

# Switch to app user
su - bluebubbles

# Clone your repo (if not done)
cd ~
git clone https://github.com/ever-just/bluebubbles-ai-agent.git agent
cd agent/agent-service

# Install dependencies
npm install

# Setup environment
cp .env.production .env
nano .env
# Add your ngrok URL and API keys

# Start databases
docker-compose up -d

# Build and start agent
npm run build
pm2 start dist/index.js --name agent
pm2 save
pm2 startup

# Check logs
pm2 logs agent
```

## 📊 Connection Status Dashboard

Check these endpoints:
- **Health Check**: http://104.248.178.178:3000/health
- **Agent Logs**: `ssh root@104.248.178.178 "pm2 logs agent"`
- **BlueBubbles Status**: Check Mac's BlueBubbles Server UI

## 🔧 Troubleshooting

### "Cannot connect to BlueBubbles"
1. ✓ Is BlueBubbles Server running on Mac?
2. ✓ Is ngrok/tunnel running?
3. ✓ Correct URL in droplet's .env?
4. ✓ Correct password?
5. ✓ Check firewall settings

### "Connection keeps dropping"
- Use Tailscale for most stable connection
- Or use autossh for persistent SSH tunnel

### "High latency"
- Try SSH tunnel for lower latency
- Consider upgrading ngrok plan
- Check your internet connection

## 🎯 Recommended Setup

**For Development**: ngrok (easy to start/stop)
**For Production**: Tailscale (reliable, survives restarts)
**For Security**: SSH tunnel (no external services)

## Next Steps

Once connected:
1. ✅ Send test message to your iPhone
2. ✅ Verify agent responds
3. ✅ Add Claude integration
4. ✅ Configure Gmail OAuth
5. ✅ Set up domain name (optional)
