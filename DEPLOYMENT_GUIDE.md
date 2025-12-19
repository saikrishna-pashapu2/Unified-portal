# AWS EC2 Deployment Guide

## Complete Step-by-Step Deployment Process

This guide documents the complete deployment process for the ESG/Credit Portal on AWS EC2 Ubuntu 22.04.

---

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Initial Server Setup](#initial-server-setup)
3. [Application Deployment](#application-deployment)
4. [PM2 Configuration](#pm2-configuration)
5. [Verification](#verification)
6. [Deploying New Versions](#deploying-new-versions)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Local Machine
- Git repository: https://github.com/bullhunter6/Unified-portal.git
- All environment variables ready (database URLs, API keys, etc.)

### AWS EC2 Instance
- **Instance Type**: t3.medium or higher
- **OS**: Ubuntu Server 22.04 LTS
- **Public IP**: Your EC2 public IP (example: 51.112.164.164)
- **Security Group**: 
  - Port 22 (SSH) - Your IP only
  - Port 3000 (Application) - 0.0.0.0/0 (or specific IPs)
  - Outbound: All traffic allowed

### AWS RDS
- PostgreSQL instances for ESG and Credit databases
- Security group allowing connections from EC2 security group

---

## Initial Server Setup

### 1. Connect to EC2 Instance
```bash
ssh -i your-key.pem ubuntu@YOUR_EC2_IP
```

### 2. Update System Packages
```bash
sudo apt update && sudo apt upgrade -y
```

### 3. Install Node.js 20
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Verify installation:
```bash
node --version  # Should show v20.x.x
```

### 4. Install pnpm
```bash
curl -fsSL https://get.pnpm.io/install.sh | sh -
source ~/.bashrc
```

Verify installation:
```bash
pnpm --version
which pnpm  # Note this path, you'll need it later
```

### 5. Install PM2 and Other Tools
```bash
sudo npm install -g pm2
sudo apt install git postgresql-client -y
```

---

## Application Deployment

### 6. Create Deployment Directory
```bash
sudo mkdir -p /var/www
cd /var/www
```

### 7. Clone Repository (First Time)
```bash
sudo git clone https://github.com/bullhunter6/Unified-portal.git portal-v1.0.0
sudo chown -R ubuntu:ubuntu portal-v1.0.0
cd portal-v1.0.0
```

### 8. Get EC2 Public IP
```bash
curl -s http://169.254.169.254/latest/meta-data/public-ipv4
```
**Note this IP address** - you'll use it in the next step.

### 9. Create Production Environment File
```bash
cat > .env << 'EOF'
# Database Configuration
DATABASE_URL="postgresql://USER:PASSWORD@RDS_ENDPOINT:5432/esg_db?schema=public&sslmode=require"
ESG_DATABASE_URL="postgresql://USER:PASSWORD@RDS_ENDPOINT:5432/esg_db?schema=public&sslmode=require"
CREDIT_DATABASE_URL="postgresql://USER:PASSWORD@RDS_ENDPOINT:5432/credit_db?schema=public&sslmode=require"

# Application Configuration
NEXTAUTH_URL="http://YOUR_EC2_IP:3000"
NEXTAUTH_SECRET="your-nextauth-secret-key"
APP_URL="http://YOUR_EC2_IP:3000"
NODE_ENV="production"
PORT=3000

# Email Configuration (Gmail SMTP)
MAIL_HOST="smtp.gmail.com"
MAIL_PORT=587
MAIL_USER="your-email@gmail.com"
MAIL_PASSWORD="your-app-specific-password"
MAIL_FROM="your-email@gmail.com"

# Alert System
CRON_SECRET="your-cron-secret-key"

# OpenAI API (for PDFX features)
OPENAI_API_KEY="your-openai-api-key"
EOF
```

**Important**: Replace all placeholder values with your actual credentials:
- `USER:PASSWORD@RDS_ENDPOINT` - Your RDS connection details
- `YOUR_EC2_IP` - Your EC2 public IP from step 8
- `your-nextauth-secret-key` - Generate with: `openssl rand -base64 32`
- `your-email@gmail.com` - Your Gmail address
- `your-app-specific-password` - Gmail App Password (not regular password)
- `your-cron-secret-key` - Generate with: `openssl rand -base64 32`
- `your-openai-api-key` - Your OpenAI API key (if using PDFX)

Set proper permissions:
```bash
chmod 600 .env
```

### 10. Copy Environment File for Next.js Build
```bash
cp .env apps/web/.env
```

### 11. Install Dependencies
```bash
pnpm install
```
This will take 3-5 minutes.

### 12. Generate Prisma Clients
```bash
pnpm db:generate
```

### 13. Build Application
```bash
cd apps/web
pnpm build
```

This should complete successfully with output like:
```
✓ Compiled successfully
✓ Linting and checking validity of types
✓ Generating static pages (36/36)
```

---

## PM2 Configuration

### 14. Create Logs Directory
```bash
cd /var/www/portal-v1.0.0
mkdir -p logs
```

### 15. Create PM2 Ecosystem Config
```bash
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'portal-v1.0.0',
    cwd: '/var/www/current/apps/web',
    script: 'node_modules/next/dist/bin/next',
    args: 'start -p 3000',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: '/var/www/current/logs/error.log',
    out_file: '/var/www/current/logs/output.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_memory_restart: '1G',
    watch: false
  }]
}
EOF
```

### 16. Create Symlink
```bash
cd /var/www
sudo ln -sf /var/www/portal-v1.0.0 /var/www/current
```

### 17. Start Application with PM2
```bash
cd /var/www/current
pm2 start ecosystem.config.js
```

### 18. Save PM2 Configuration
```bash
pm2 save
```

### 19. Setup PM2 Auto-Start on Reboot
```bash
pm2 startup
```

Copy the command that PM2 outputs (starts with `sudo env PATH=...`) and run it.

---

## Verification

### 20. Check PM2 Status
```bash
pm2 status
```

Should show:
```
┌────┬──────────────────┬─────────┬─────────┬────────┬─────────┐
│ id │ name             │ mode    │ status  │ uptime │ memory  │
├────┼──────────────────┼─────────┼─────────┼────────┼─────────┤
│ 0  │ portal-v1.0.0    │ fork    │ online  │ Xs     │ XXmb    │
└────┴──────────────────┴─────────┴─────────┴────────┴─────────┘
```

### 21. Test Local Connection
```bash
curl -I http://localhost:3000
```

Should return:
```
HTTP/1.1 307 Temporary Redirect
Location: /esg
...
```

### 22. View Application Logs
```bash
pm2 logs portal-v1.0.0 --lines 50
```

### 23. Test From Browser
Open in your browser:
```
http://YOUR_EC2_IP:3000
```

You should see your application's homepage redirecting to `/esg`.

### 24. Test Key Features
- Homepage: `http://YOUR_EC2_IP:3000`
- ESG Articles: `http://YOUR_EC2_IP:3000/esg/articles`
- Credit Articles: `http://YOUR_EC2_IP:3000/credit/articles`
- Sign In: `http://YOUR_EC2_IP:3000/signin`
- Admin Panel: `http://YOUR_EC2_IP:3000/admin` (after login)

---

## Deploying New Versions

### Strategy
We use versioned deployments with symlinks for zero-downtime updates.

### Step-by-Step Process

#### 1. On Local Machine - Push Changes to Git
```bash
# Commit your changes
git add .
git commit -m "Tools page and community page Updates"
git push origin main
```

#### 2. On EC2 - Clone New Version
```bash
cd /var/www
sudo git clone https://github.com/bullhunter6/Unified-portal.git portal-v1.0.5
sudo chown -R ubuntu:ubuntu portal-v1.0.5
cd portal-v1.0.5
```

#### 3. Copy Environment File
```bash
cp /var/www/portal-v1.0.4/.env .env
cp .env apps/web/.env
```

#### 4. Install Dependencies
```bash
pnpm install
```

#### 5. Generate Prisma Clients
```bash
pnpm db:generate
```

#### 6. Build Application
```bash
cd apps/web
pnpm build
cd ../..
```

#### 7. Create Logs Directory
```bash
mkdir -p logs
```

#### 8. Update Ecosystem Config
```bash
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'portal-v1.0.5',
    cwd: '/var/www/current/apps/web',
    script: 'node_modules/next/dist/bin/next',
    args: 'start -p 3000',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: '/var/www/current/logs/error.log',
    out_file: '/var/www/current/logs/output.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_memory_restart: '1G',
    watch: false
  }]
}
EOF
```

**Note**: Update the `name` field to match your new version (e.g., `portal-v1.0.1`).

#### 9. Stop Old Version
```bash
pm2 delete all
```

#### 10. Update Symlink
```bash
cd /var/www
sudo ln -sfn /var/www/portal-v1.0.5 /var/www/current
```

#### 11. Start New Version
```bash
cd /var/www/current
pm2 start ecosystem.config.js
pm2 save
```

#### 12. Verify New Version
```bash
pm2 status
curl -I http://localhost:3000
```

#### 13. Test in Browser
Visit `http://YOUR_EC2_IP:3000` and verify everything works.

#### 14. (Optional) Clean Up Old Version
After confirming the new version works for a few days:
```bash
sudo rm -rf /var/www/portal-v1.0.4
```

---

## Useful PM2 Commands

### Check Status
```bash
pm2 status
```

### View Logs (Live)
```bash
pm2 logs portal-v1.0.4
```

### View Last 50 Lines
```bash
pm2 logs portal-v1.0.5 --lines 50 --nostream
```

### Restart Application
```bash
pm2 restart portal-v1.0.4
```

### Stop Application
```bash
pm2 stop portal-v1.0.0
```

### Delete Application
```bash
pm2 delete portal-v1.0.0
```

### Monitor Resources
```bash
pm2 monit
```

### List All Processes
```bash
pm2 list
```

---

## Troubleshooting

### Application Won't Start

**Check PM2 Status:**
```bash
pm2 status
```

**View Error Logs:**
```bash
pm2 logs portal-v1.0.0 --err --lines 100
```

**Check if Port 3000 is in Use:**
```bash
sudo lsof -i :3000
```

**Try Running Manually:**
```bash
cd /var/www/current/apps/web
pnpm start
```
Press Ctrl+C to stop, then restart with PM2.

### Can't Access from Browser

**1. Check EC2 Security Group:**
- Go to EC2 Console → Security Groups
- Verify inbound rule allows port 3000 from 0.0.0.0/0

**2. Check Application is Running:**
```bash
pm2 status
curl http://localhost:3000
```

**3. Check AWS Public IP:**
```bash
curl -s http://169.254.169.254/latest/meta-data/public-ipv4
```

### Database Connection Errors

**Check Environment Variables:**
```bash
cd /var/www/current
cat .env | grep DATABASE_URL
```

**Test Database Connection:**
```bash
psql "postgresql://USER:PASSWORD@RDS_ENDPOINT:5432/esg_db?sslmode=require"
```

**Check RDS Security Group:**
- Verify RDS security group allows connections from EC2 security group

### Email Not Sending

**Check Email Configuration:**
```bash
cd /var/www/current
cat .env | grep MAIL_
```

**Verify Gmail App Password:**
- Must use App Password, not regular Gmail password
- Generate at: https://myaccount.google.com/apppasswords

### High Memory Usage

**Check Memory Usage:**
```bash
pm2 monit
free -h
```

**Restart Application:**
```bash
pm2 restart portal-v1.0.5
```

**Increase Max Memory (if needed):**
Edit `ecosystem.config.js` and change:
```javascript
max_memory_restart: '2G'  // Increase from 1G to 2G
```

Then reload:
```bash
pm2 reload ecosystem.config.js
```

### PM2 Not Starting on Reboot

**Re-run Startup Command:**
```bash
pm2 startup
# Copy and run the command it outputs
pm2 save
```

**Check Systemd Service:**
```bash
systemctl status pm2-ubuntu
```

### Application Logs Empty

If PM2 logs are empty but app is errored, check:

**1. File Permissions:**
```bash
ls -la /var/www/current/logs/
```

**2. PM2 Default Logs:**
```bash
ls -la ~/.pm2/logs/
cat ~/.pm2/logs/portal-v1.0.0-error.log
```

**3. Try Running Manually:**
```bash
cd /var/www/current/apps/web
node node_modules/next/dist/bin/next start -p 3000
```

---

## File Structure on EC2

```
/var/www/
├── portal-v1.0.0/           # First deployment
│   ├── .env                 # Environment variables
│   ├── ecosystem.config.js  # PM2 configuration
│   ├── logs/                # Application logs
│   │   ├── error.log
│   │   └── output.log
│   ├── apps/
│   │   └── web/
│   │       ├── .env         # Copy of root .env
│   │       ├── .next/       # Built application
│   │       └── node_modules/
│   ├── packages/
│   └── [other repository files]
│
├── portal-v1.0.1/           # New version deployment
│   └── [same structure]
│
└── current -> portal-v1.0.1 # Symlink to active version
```

---

## Security Best Practices

1. **Environment Files**: Never commit `.env` files to Git
2. **File Permissions**: Keep `.env` files with `chmod 600`
3. **SSH Keys**: Use SSH key authentication, disable password auth
4. **Security Groups**: Restrict SSH (port 22) to your IP only
5. **Regular Updates**: Keep Ubuntu and Node.js updated
6. **Monitoring**: Set up monitoring (Sentry, LogRocket, etc.)
7. **Backups**: Regular RDS automated backups
8. **Secrets Rotation**: Regularly rotate API keys and passwords

---

## Performance Optimization

### Enable PM2 Cluster Mode (Optional)
For better performance on multi-core instances, update `ecosystem.config.js`:

```javascript
instances: 2,           // Number of instances
exec_mode: 'cluster',   // Cluster mode
```

Then restart:
```bash
pm2 reload ecosystem.config.js
```

### Database Optimization
Apply indexes from `DATABASE_ARCHITECTURE.md` if you have many records.

---

## Monitoring & Maintenance

### Daily Checks
```bash
pm2 status
pm2 logs portal-v1.0.5
```

### Weekly Maintenance
```bash
# Check disk space
df -h

# Check memory usage
free -h

# Update system packages
sudo apt update && sudo apt upgrade -y

# Check PM2 logs size
du -sh /var/www/current/logs/*
```

### Monthly Tasks
- Review and rotate logs
- Check RDS performance metrics
- Review AWS billing
- Update Node.js if new LTS version available

---

## Contact & Support

- **Repository**: https://github.com/bullhunter6/Unified-portal
- **EC2 Instance**: Ubuntu 22.04 LTS
- **Application URL**: http://YOUR_EC2_IP:3000

---

## Quick Reference Commands

```bash
# Check application status
pm2 status

# View logs
pm2 logs portal-v1.0.0

# Restart application
pm2 restart portal-v1.0.0

# Update code (simple update - same version)
cd /var/www/current && git pull origin main && pnpm install && pnpm build && pm2 restart portal-v1.0.5

# Check what's listening on port 3000
sudo lsof -i :3000

# Test local connection
curl http://localhost:3000

# Get EC2 public IP
curl -s http://169.254.169.254/latest/meta-data/public-ipv4
```

---

**Deployment Completed**: October 15, 2025
**Document Version**: 1.0.0

              