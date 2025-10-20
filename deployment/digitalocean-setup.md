# DigitalOcean Droplet Setup Guide

## Your Droplet Details
- **Name**: agent-one
- **Public IP**: 104.248.178.178
- **Private IP**: 10.120.0.3
- **Region**: SFO2 (San Francisco)
- **Specs**: 2 GB RAM / 1 vCPU / 70 GB SSD
- **OS**: Ubuntu 22.04 LTS x64

## Initial Setup Steps

### Step 1: SSH into your Droplet
```bash
ssh root@104.248.178.178
```

### Step 2: Create a non-root user
```bash
# On the droplet
adduser bluebubbles
usermod -aG sudo bluebubbles

# Add SSH key for the new user
su - bluebubbles
mkdir ~/.ssh
chmod 700 ~/.ssh
# Copy your SSH public key to:
nano ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
exit
```

### Step 3: Basic Security Setup
```bash
# As root or with sudo
# Update system
apt update && apt upgrade -y

# Install essential packages
apt install -y \
  curl \
  wget \
  git \
  build-essential \
  ufw \
  fail2ban \
  nginx \
  certbot \
  python3-certbot-nginx

# Configure firewall
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp  # For agent service
ufw --force enable

# Configure fail2ban
systemctl start fail2ban
systemctl enable fail2ban
```

### Step 4: Install Docker and Docker Compose
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
usermod -aG docker bluebubbles

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
```

### Step 5: Install Node.js
```bash
# Install Node.js 18 LTS
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

### Step 6: Clone and Setup Your Agent Service
```bash
# Switch to bluebubbles user
su - bluebubbles

# Clone your agent service (once you push it to GitHub)
git clone https://github.com/ever-just/bluebubbles-ai-agent.git
cd bluebubbles-ai-agent/agent-service

# Install dependencies
npm install

# Setup environment
cp .env.example .env
nano .env  # Edit with your credentials
```

### Step 7: Configure Environment Variables
Edit `.env` on the droplet:
```bash
# Node Environment
NODE_ENV=production
PORT=3000

# Claude API
ANTHROPIC_API_KEY=your-actual-key

# BlueBubbles Connection
# This needs to connect to your Mac!
BLUEBUBBLES_URL=http://YOUR_MAC_IP:1234  # See connection options below
BLUEBUBBLES_PASSWORD=your-password

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-secret
REDIRECT_URI=http://104.248.178.178:3000/auth/google/callback

# Database (using Docker containers)
DATABASE_URL=postgresql://postgres:password@localhost:5432/bluebubbles_agent
REDIS_URL=redis://localhost:6379

# Security
ENCRYPTION_KEY=generate-64-char-hex
SESSION_SECRET=generate-random-string
```

### Step 8: Start Services
```bash
# Start databases
docker-compose up -d

# Start agent service (for testing)
npm run dev

# For production, use PM2
npm install -g pm2
npm run build
pm2 start dist/index.js --name agent-service
pm2 save
pm2 startup
```

## Connecting Your Mac to the Droplet

### Option 1: Using ngrok (Easiest)
On your Mac:
```bash
# Install ngrok
brew install ngrok

# Start ngrok tunnel
ngrok http 1234

# You'll get a URL like: https://abc123.ngrok.io
# Use this URL in your droplet's .env file:
# BLUEBUBBLES_URL=https://abc123.ngrok.io
```

### Option 2: SSH Reverse Tunnel (More Secure)
On your Mac:
```bash
# Create reverse SSH tunnel
ssh -R 1234:localhost:1234 bluebubbles@104.248.178.178

# Keep this running while using the agent
# The droplet can now access your Mac's BlueBubbles on localhost:1234
```

### Option 3: Direct Connection (If Mac has public IP)
```bash
# On your Mac, configure router to forward port 1234
# Then in droplet .env:
# BLUEBUBBLES_URL=http://YOUR_PUBLIC_IP:1234
```

### Option 4: Tailscale VPN (Most Reliable)
```bash
# Install Tailscale on both Mac and Droplet
# Mac:
brew install tailscale
tailscale up

# Droplet:
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up

# Use Tailscale IP in .env:
# BLUEBUBBLES_URL=http://100.x.x.x:1234
```

## Domain Setup (Optional)
```bash
# Point your domain to 104.248.178.178
# Then setup nginx reverse proxy

nano /etc/nginx/sites-available/agent

# Add:
server {
    listen 80;
    server_name yourdomain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

# Enable site
ln -s /etc/nginx/sites-available/agent /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx

# Add SSL
certbot --nginx -d yourdomain.com
```

## Monitoring Setup
```bash
# Install monitoring tools
apt install -y htop nethogs iotop

# Setup PM2 monitoring
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7

# View logs
pm2 logs agent-service
```

## Useful Commands
```bash
# Check agent service status
pm2 status

# View agent logs
pm2 logs agent-service

# Restart agent
pm2 restart agent-service

# Check Docker containers
docker ps

# View Docker logs
docker-compose logs -f

# Check system resources
htop

# Check network connections
netstat -tlpn

# Test connection to BlueBubbles
curl http://localhost:1234  # From droplet, if using SSH tunnel
```

## Security Checklist
- [ ] SSH key authentication only (disable password auth)
- [ ] Firewall configured (ufw)
- [ ] Fail2ban installed
- [ ] Non-root user created
- [ ] Environment variables secured
- [ ] SSL certificate (if using domain)
- [ ] Regular system updates scheduled

## Troubleshooting

### Can't connect to BlueBubbles?
1. Check Mac is running BlueBubbles Server
2. Verify connection method (ngrok/SSH tunnel/etc)
3. Test with curl from droplet
4. Check firewall on both Mac and droplet

### Agent service won't start?
1. Check logs: `pm2 logs agent-service`
2. Verify .env file has all required values
3. Ensure databases are running: `docker ps`
4. Check Node.js version: `node --version`

### High memory usage?
1. Check PM2 processes: `pm2 monit`
2. Restart if needed: `pm2 restart all`
3. Check Docker: `docker stats`
