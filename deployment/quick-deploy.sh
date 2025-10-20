#!/bin/bash
# Quick deployment script for DigitalOcean droplet
# Run this on your droplet after SSHing in

set -e

echo "🚀 BlueBubbles AI Agent - Quick Deploy Script"
echo "============================================"
echo "Droplet IP: 104.248.178.178"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Update system
echo -e "${YELLOW}Updating system packages...${NC}"
apt update && apt upgrade -y

# Install essential packages
echo -e "${YELLOW}Installing essential packages...${NC}"
apt install -y \
  curl \
  wget \
  git \
  build-essential \
  ufw \
  fail2ban \
  nginx \
  certbot \
  python3-certbot-nginx \
  htop \
  nethogs

# Install Docker
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Installing Docker...${NC}"
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
else
    echo -e "${GREEN}Docker already installed${NC}"
fi

# Install Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo -e "${YELLOW}Installing Docker Compose...${NC}"
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
else
    echo -e "${GREEN}Docker Compose already installed${NC}"
fi

# Install Node.js 18 LTS
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}Installing Node.js 18 LTS...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
else
    echo -e "${GREEN}Node.js already installed: $(node --version)${NC}"
fi

# Install PM2
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}Installing PM2...${NC}"
    npm install -g pm2
else
    echo -e "${GREEN}PM2 already installed${NC}"
fi

# Configure firewall
echo -e "${YELLOW}Configuring firewall...${NC}"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp
ufw --force enable

# Create user if not exists
if ! id -u bluebubbles > /dev/null 2>&1; then
    echo -e "${YELLOW}Creating bluebubbles user...${NC}"
    adduser --disabled-password --gecos "" bluebubbles
    usermod -aG sudo bluebubbles
    usermod -aG docker bluebubbles
    
    # Setup SSH for user
    mkdir -p /home/bluebubbles/.ssh
    cp ~/.ssh/authorized_keys /home/bluebubbles/.ssh/
    chown -R bluebubbles:bluebubbles /home/bluebubbles/.ssh
    chmod 700 /home/bluebubbles/.ssh
    chmod 600 /home/bluebubbles/.ssh/authorized_keys
else
    echo -e "${GREEN}User bluebubbles already exists${NC}"
fi

# Create project directory
echo -e "${YELLOW}Setting up project directory...${NC}"
mkdir -p /home/bluebubbles/agent
chown -R bluebubbles:bluebubbles /home/bluebubbles/agent

# Create systemd service for agent
cat > /etc/systemd/system/bluebubbles-agent.service << EOF
[Unit]
Description=BlueBubbles AI Agent Service
After=network.target

[Service]
Type=simple
User=bluebubbles
WorkingDirectory=/home/bluebubbles/agent/agent-service
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=10
StandardOutput=append:/var/log/bluebubbles-agent.log
StandardError=append:/var/log/bluebubbles-agent.error.log

[Install]
WantedBy=multi-user.target
EOF

# Setup nginx config
cat > /etc/nginx/sites-available/bluebubbles-agent << 'EOF'
server {
    listen 80;
    server_name 104.248.178.178;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    location /health {
        proxy_pass http://localhost:3000/health;
    }
}
EOF

# Enable nginx site
ln -sf /etc/nginx/sites-available/bluebubbles-agent /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

echo ""
echo -e "${GREEN}✅ Basic setup complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Switch to bluebubbles user: ${YELLOW}su - bluebubbles${NC}"
echo "2. Clone your repository:"
echo "   ${YELLOW}cd ~/agent${NC}"
echo "   ${YELLOW}git clone https://github.com/ever-just/bluebubbles-ai-agent.git .${NC}"
echo "3. Setup agent service:"
echo "   ${YELLOW}cd agent-service${NC}"
echo "   ${YELLOW}npm install${NC}"
echo "   ${YELLOW}cp .env.example .env${NC}"
echo "   ${YELLOW}nano .env${NC}  # Add your API keys"
echo "4. Start databases:"
echo "   ${YELLOW}docker-compose up -d${NC}"
echo "5. Start agent:"
echo "   ${YELLOW}npm run build${NC}"
echo "   ${YELLOW}pm2 start dist/index.js --name agent${NC}"
echo ""
echo "Your droplet IPs:"
echo "  Public:  ${GREEN}104.248.178.178${NC}"
echo "  Private: ${GREEN}10.120.0.3${NC}"
echo ""
echo "Test endpoints:"
echo "  ${GREEN}http://104.248.178.178/health${NC}"
echo "  ${GREEN}http://104.248.178.178:3000/health${NC}"
