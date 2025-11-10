# HTTPS Setup Guide - ESG/Credit Portal

## 🔒 Adding HTTPS to Your Portal

This guide shows you how to add HTTPS to your portal running on AWS EC2. We'll use **Nginx** as a reverse proxy with **Let's Encrypt** for a free SSL certificate.

---

## Prerequisites

- EC2 instance running on AWS (already set up)
- Portal running on port 3000 with PM2 (already done)
- **Domain name** pointing to your EC2 IP (required for Let's Encrypt)
  - If you don't have a domain, see [Option B: Self-Signed Certificate](#option-b-self-signed-certificate-no-domain-needed)

---

## Table of Contents

1. [Option A: Let's Encrypt (Recommended - Requires Domain)](#option-a-lets-encrypt-recommended)
2. [Option B: Self-Signed Certificate (No Domain)](#option-b-self-signed-certificate-no-domain-needed)
3. [Option C: AWS Application Load Balancer](#option-c-aws-application-load-balancer)
4. [Update NextAuth Configuration](#step-final-update-nextauth-configuration)
5. [Troubleshooting](#troubleshooting)

---

## Option A: Let's Encrypt (Recommended)

**Best for:** Production use with a domain name
**Cost:** Free
**Validity:** 90 days (auto-renews)

### Step 1: Get a Domain Name

If you don't have one, purchase from:
- **Namecheap**: ~$10/year
- **GoDaddy**: ~$15/year
- **AWS Route 53**: ~$12/year
- **Freenom**: Free (limited TLDs)

### Step 2: Point Domain to EC2 IP but 

In your domain registrar's DNS settings:

```
Type: A Record
Name: @  (or your subdomain like 'portal')
Value: YOUR_EC2_PUBLIC_IP
TTL: 300 (5 minutes)
```

**Example:**
```
A Record: portal.yourdomain.com → 51.112.164.164
```

Wait 5-30 minutes for DNS to propagate. Test with:
```bash
ping portal.yourdomain.com
```

### Step 3: Update EC2 Security Group

1. Go to AWS Console → EC2 → Security Groups
2. Select your EC2's security group
3. Add these inbound rules:

```
Type: HTTP
Port: 80
Source: 0.0.0.0/0

Type: HTTPS
Port: 443
Source: 0.0.0.0/0

Type: Custom TCP
Port: 3000
Source: 127.0.0.1/32  (localhost only - we'll access via Nginx)
```

### Step 4: SSH to Your EC2 Instance

```bash
ssh -i your-key.pem ubuntu@YOUR_EC2_IP
```

### Step 5: Install Nginx

```bash
sudo apt update
sudo apt install nginx -y
```

Verify Nginx is running:
```bash
sudo systemctl status nginx
```

### Step 6: Install Certbot (Let's Encrypt Client)

```bash
sudo apt install certbot python3-certbot-nginx -y
```

### Step 7: Configure Nginx for Your Portal

Create Nginx configuration:

```bash
sudo nano /etc/nginx/sites-available/portal
```

Paste this configuration (replace `portal.yourdomain.com` with your actual domain):

```nginx
server {
    listen 80;
    server_name portal.yourdomain.com;

    # Allow Let's Encrypt verification
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Redirect all other HTTP traffic to HTTPS
    location / {
        return 301 https://$server_name$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name portal.yourdomain.com;

    # SSL certificates (will be added by Certbot)
    ssl_certificate /etc/letsencrypt/live/portal.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/portal.yourdomain.com/privkey.pem;

    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Proxy settings
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts for long-running requests (AI Assistant, PDF translation)
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # Increase upload size for PDF uploads
    client_max_body_size 50M;
}
```

Save and exit (Ctrl+X, then Y, then Enter).

### Step 8: Enable the Site

```bash
sudo ln -s /etc/nginx/sites-available/portal /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default  # Remove default site
```

Test Nginx configuration:
```bash
sudo nginx -t
```

Should show:
```
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

Reload Nginx:
```bash
sudo systemctl reload nginx
```

### Step 9: Obtain SSL Certificate

Run Certbot (replace with your domain and email):

```bash
sudo certbot --nginx -d portal.yourdomain.com --email your-email@gmail.com --agree-tos --no-eff-email
```

**Important**: When asked, choose option **2** (Redirect HTTP to HTTPS).

Certbot will:
1. Verify you own the domain
2. Generate SSL certificate
3. Update Nginx configuration
4. Set up auto-renewal

You should see:
```
Successfully received certificate.
Certificate is saved at: /etc/letsencrypt/live/portal.yourdomain.com/fullchain.pem
Key is saved at: /etc/letsencrypt/live/portal.yourdomain.com/privkey.pem
```

### Step 10: Verify Auto-Renewal

```bash
sudo certbot renew --dry-run
```

Should show:
```
Congratulations, all simulated renewals succeeded
```

### Step 11: Test HTTPS

Open in your browser:
```
https://portal.yourdomain.com
```

You should see:
- 🔒 Padlock icon in the address bar
- Valid SSL certificate
- Your portal loads correctly

### Step 12: Update Environment Variables

```bash
cd /var/www/current
nano .env
```

Update these lines:
```bash
NEXTAUTH_URL="https://portal.yourdomain.com"
APP_URL="https://portal.yourdomain.com"
```

Also update `apps/web/.env`:
```bash
nano apps/web/.env
```

Same changes:
```bash
NEXTAUTH_URL="https://portal.yourdomain.com"
APP_URL="https://portal.yourdomain.com"
```

### Step 13: Restart Portal

```bash
pm2 restart all
```

### ✅ Done! Your portal is now running on HTTPS!

---

## Option B: Self-Signed Certificate (No Domain Needed)

**Best for:** Testing, internal use, or when you don't have a domain
**Cost:** Free
**Warning:** Browsers will show "Not Secure" warning (you'll need to manually accept)

### Step 1: Install Nginx

```bash
sudo apt update
sudo apt install nginx -y
```

### Step 2: Generate Self-Signed Certificate

```bash
sudo mkdir -p /etc/nginx/ssl
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/nginx-selfsigned.key \
  -out /etc/nginx/ssl/nginx-selfsigned.crt
```

When prompted, fill in:
```
Country Name: KZ
State: Your State
Locality: Your City
Organization Name: Your Company
Organizational Unit: IT
Common Name: YOUR_EC2_IP  (e.g., 51.112.164.164)
Email Address: your-email@example.com
```

**Important**: For "Common Name", enter your EC2 public IP address.

### Step 3: Create Nginx Configuration

```bash
sudo nano /etc/nginx/sites-available/portal
```

Paste this:

```nginx
server {
    listen 80;
    server_name _;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name _;

    # Self-signed SSL certificate
    ssl_certificate /etc/nginx/ssl/nginx-selfsigned.crt;
    ssl_certificate_key /etc/nginx/ssl/nginx-selfsigned.key;

    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security headers
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Proxy to Next.js
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    client_max_body_size 50M;
}
```

### Step 4: Enable Site

sudo ln -s /etc/nginx/sites-available/portal /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

### Step 5: Update Security Group

Add inbound rules for ports 80 and 443 (same as Option A, Step 3).

### Step 6: Update Environment Variables

```bash
cd /var/www/current
nano .env
```

Update:
```bash
NEXTAUTH_URL="https://YOUR_EC2_IP"
APP_URL="https://YOUR_EC2_IP"
```

Also update `apps/web/.env` with the same changes.

### Step 7: Restart Portal

```bash
pm2 restart all
```

### Step 8: Access Your Portal

Open in browser:
```
https://YOUR_EC2_IP
```

You'll see a warning: **"Your connection is not private"**

**To bypass:**
- **Chrome/Edge**: Click "Advanced" → "Proceed to [IP] (unsafe)"
- **Firefox**: Click "Advanced" → "Accept the Risk and Continue"
- **Safari**: Click "Show Details" → "visit this website"

This is expected with self-signed certificates. The connection is still encrypted, but not verified by a trusted authority.

---

## Option C: AWS Application Load Balancer

**Best for:** Enterprise production, auto-scaling, multiple instances
**Cost:** ~$16/month + data transfer fees
**Benefits:** AWS-managed SSL, health checks, auto-scaling

### Quick Steps:

1. **Get SSL Certificate from ACM**
   - Go to AWS Certificate Manager
   - Request public certificate
   - Enter your domain name
   - Validate via DNS or email

2. **Create Application Load Balancer**
   - EC2 → Load Balancers → Create
   - Type: Application Load Balancer
   - Listeners: HTTP (80) and HTTPS (443)
   - Availability Zones: Select at least 2
   - Security Groups: Allow 80, 443

3. **Create Target Group**
   - Target type: Instances
   - Protocol: HTTP
   - Port: 3000
   - Health check path: `/`
   - Register your EC2 instance

4. **Configure HTTPS Listener**
   - Add listener on port 443
   - Forward to target group
   - Select ACM certificate
   - Add rule to redirect HTTP → HTTPS

5. **Update DNS**
   - Point domain to ALB DNS name (CNAME record)

6. **Update Environment**
   - `NEXTAUTH_URL="https://yourdomain.com"`

This option is more complex but provides better scalability and AWS integration.

---

## Step FINAL: Update NextAuth Configuration

After enabling HTTPS (any option), update NextAuth settings:

```bash
cd /var/www/current/apps/web/src/lib
nano nextauth-options.ts
```

Find the NextAuth configuration and ensure these settings:

```typescript
export const authOptions: NextAuthOptions = {
  // ... existing config ...
  
  cookies: {
    sessionToken: {
      name: `__Secure-next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production', // true in production
      },
    },
  },
  
  // Reduce session time for better security
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours (instead of 30 days)
  },
  
  // ... rest of config ...
};
```

Rebuild and restart:
```bash
cd /var/www/current
pnpm db:generate
cd apps/web
pnpm build
cd ../..
pm2 restart all
```

---

## Verification Checklist

After setup, verify these:

- [ ] **HTTPS works**: `https://yourdomain.com` loads with padlock icon
- [ ] **HTTP redirects**: `http://yourdomain.com` redirects to HTTPS
- [ ] **Login works**: Can sign in without errors
- [ ] **Session persists**: Stays logged in after refresh
- [ ] **All pages work**: ESG/Credit articles, events, admin panel
- [ ] **AI tools work**: Article Assistant, PDF Translation
- [ ] **Emails send**: Alert system sends emails correctly
- [ ] **Admin panel**: Scheduler controls work
- [ ] **SSL valid**: No browser warnings (Option A only)
- [ ] **Certificate auto-renews**: `sudo certbot renew --dry-run` succeeds (Option A only)

---

## Security Hardening (Recommended)

### 1. Change All Secrets

```bash
cd /var/www/current
nano .env
```

Update:
```bash
NEXTAUTH_SECRET="<run: openssl rand -hex 32>"
CRON_SECRET="<run: openssl rand -hex 32>"
```

Copy to apps/web:
```bash
cp .env apps/web/.env
pm2 restart all
```

### 2. Restrict Port 3000

Update EC2 Security Group:
```
Type: Custom TCP
Port: 3000
Source: 127.0.0.1/32  (only localhost can access)
```

Now port 3000 is only accessible via Nginx, not directly from internet.

### 3. Enable Firewall

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

### 4. Set Up Fail2Ban (Prevent Brute Force)

```bash
sudo apt install fail2ban -y
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

---

## Troubleshooting

### Issue: "502 Bad Gateway"

**Cause**: Nginx can't connect to port 3000

**Fix:**
```bash
# Check if portal is running
pm2 status

# Check if port 3000 is listening
sudo lsof -i :3000

# Check Nginx error log
sudo tail -f /var/log/nginx/error.log

# Restart portal
pm2 restart all

# Restart Nginx
sudo systemctl restart nginx
```

### Issue: "This site can't be reached"

**Cause**: Security group not allowing ports 80/443

**Fix:**
1. Go to EC2 → Security Groups
2. Add inbound rules for ports 80 and 443
3. Try again after 1 minute

### Issue: "Your connection is not private" (Option A)

**Cause**: Certificate not properly installed

**Fix:**
```bash
# Re-run Certbot
sudo certbot --nginx -d portal.yourdomain.com

# Check certificate exists
sudo ls -la /etc/letsencrypt/live/portal.yourdomain.com/

# Test Nginx config
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

### Issue: Login doesn't work after HTTPS

**Cause**: `NEXTAUTH_URL` not updated

**Fix:**
```bash
cd /var/www/current
nano .env  # Update NEXTAUTH_URL to https://...
nano apps/web/.env  # Same update
pm2 restart all
```

### Issue: Mixed content warnings

**Cause**: Some resources loaded over HTTP

**Fix:** Check browser console, update any hardcoded `http://` URLs to `https://` or use relative URLs.

### Issue: Certificate expired (Option A)

**Cause**: Auto-renewal failed

**Fix:**
```bash
# Manually renew
sudo certbot renew

# Check renewal timer
sudo systemctl status certbot.timer

# Test auto-renewal
sudo certbot renew --dry-run
```

---

## Monitoring SSL Certificate

### Check Certificate Expiry

```bash
echo | openssl s_client -servername portal.yourdomain.com -connect portal.yourdomain.com:443 2>/dev/null | openssl x509 -noout -dates
```

### List All Certbot Certificates

```bash
sudo certbot certificates
```

### Manual Renewal (if needed)

```bash
sudo certbot renew --force-renewal
sudo systemctl reload nginx
```

---

## Performance Tuning

### Enable Nginx Caching (Optional)

Add to Nginx config inside `server` block:

```nginx
# Cache static files
location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf)$ {
    proxy_pass http://localhost:3000;
    proxy_cache_valid 200 1h;
    add_header Cache-Control "public, max-age=3600";
}
```

### Enable Gzip Compression

Add to Nginx config:

```nginx
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;
```

---

## Cost Comparison

| Option | Setup Cost | Monthly Cost | Renewal Effort |
|--------|-----------|--------------|----------------|
| **A: Let's Encrypt** | $10-15 (domain) | $1 (domain) | Auto-renewal |
| **B: Self-Signed** | $0 | $0 | Manual yearly |
| **C: AWS ALB** | $0 | $16+ | Auto-renewal |

---

## Recommended: Option A (Let's Encrypt)

✅ **Use if:** You want production-ready HTTPS with no browser warnings
✅ **Cost:** ~$10/year for domain name
✅ **Time:** 30-45 minutes setup
✅ **Maintenance:** Automatic (renews every 90 days)

---

## Quick Commands Reference

```bash
# Check Nginx status
sudo systemctl status nginx

# Test Nginx config
sudo nginx -t

# Reload Nginx (after config changes)
sudo systemctl reload nginx

# Restart Nginx
sudo systemctl restart nginx

# View Nginx error log
sudo tail -f /var/log/nginx/error.log

# Check SSL certificate
sudo certbot certificates

# Renew SSL certificate
sudo certbot renew

# Test renewal
sudo certbot renew --dry-run

# Check portal status
pm2 status

# Restart portal
pm2 restart all

# View portal logs
pm2 logs portal-v1.0.0
```

---

## Next Steps After HTTPS Setup

1. ✅ Update `SECURITY_ASSESSMENT.md` - mark HTTPS as ✅ FIXED
2. ✅ Test all features (login, AI tools, email alerts)
3. ✅ Update documentation with your domain
4. ✅ Set up monitoring (CloudWatch, UptimeRobot)
5. ✅ Configure backups
6. ✅ Enable AWS GuardDuty (optional)

---

**Questions?** Check the Troubleshooting section or review `/var/log/nginx/error.log` for errors.

**Success?** Your portal is now secure with HTTPS! 🔒✅
