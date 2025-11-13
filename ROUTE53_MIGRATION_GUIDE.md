# AWS Route 53 Migration Guide - Complete Step-by-Step

## 🎯 What You'll Get

**From:** `https://unifiedportal.duckdns.org` (free subdomain, requires maintenance)  
**To:** `https://portal.yourdomain.com` (professional domain, zero maintenance)

**Cost:** 
- Domain: $12/year (one-time)
- Route 53: $0.50/month
- SSL Certificate: $0 (AWS provides free)
- **Total: ~$2/month**

---

## 📋 Overview of Steps

1. Register domain name on AWS Route 53 (15 minutes)
2. Create hosted zone (automatic)
3. Request free SSL certificate from AWS ACM (5 minutes)
4. Update Nginx configuration (10 minutes)
5. Update portal environment variables (5 minutes)
6. Clean up DuckDNS (5 minutes)

**Total Time:** ~40 minutes  
**Difficulty:** Easy (copy-paste commands)

---

## Step 1: Register Domain on AWS Route 53

### 1.1 Go to Route 53

1. Open **AWS Console** → Search for **"Route 53"**
2. Click **"Registered domains"** in left sidebar
3. Click **"Register domain"** button

### 1.2 Choose Your Domain Name

**Examples:**
- `esgportal.com` (if available)
- `unifiedportal.com`
- `yourcompany-esg.com`
- `esg-credit-portal.com`

**Tips:**
- Keep it short and memorable
- `.com` is most professional ($12/year)
- `.net`, `.org` also good ($12/year)
- `.xyz`, `.tech` cheaper ($5-8/year) but less professional

**In the search box, type your desired domain:**
```
esgportal.com
```

Click **"Check"**

### 1.3 Add to Cart

If available:
1. Click **"Add to cart"**
2. Choose registration period: **1 year** (you can renew later)
3. Click **"Continue"**

### 1.4 Enter Contact Information

**Auto-renew:** Enable (recommended)
**Privacy protection:** Enable (hides your contact info from WHOIS)

Fill in:
- First name, Last name
- Email address
- Phone number
- Address

**Important:** Use real email - AWS will send verification link!

### 1.5 Complete Purchase

1. Review terms and conditions
2. Check "I have read and agree..."
3. Click **"Complete order"**
4. Pay with credit card (~$12)

### 1.6 Verify Email

1. Check your email inbox
2. Find email from Amazon Registrar
3. Click verification link
4. **Domain registration takes 10-30 minutes**

---

## Step 2: Create Hosted Zone (Automatic)

AWS automatically creates a hosted zone when you register a domain. Verify:

1. Go to **Route 53** → **Hosted zones**
2. You should see your domain (e.g., `esgportal.com`)
3. Click on it
4. You'll see 2 default records:
   - `NS` (nameservers)
   - `SOA` (start of authority)

**✅ This is normal - proceed to next step.**

---

## Step 3: Point Domain to Your EC2 IP

### 3.1 Create A Record

1. In your hosted zone, click **"Create record"**
2. Configure:

```
Record name: portal  (or leave empty for root domain)
Record type: A - Routes traffic to an IPv4 address
Value: 51.112.164.164  (your EC2 public IP)
TTL: 300 (5 minutes)
Routing policy: Simple routing
```

**Examples:**
- **If you enter "portal":** Creates `portal.esgportal.com`
- **If you leave empty:** Creates `esgportal.com` (root domain)

**I recommend:** Use "portal" subdomain for clarity.

3. Click **"Create records"**

### 3.2 Test DNS (Wait 2-5 Minutes)

From your local computer:

```bash
# Windows PowerShell
nslookup portal.esgportal.com

# Should show:
# Address: 51.112.164.164
```

Or use online tool: https://dnschecker.org

---

## Step 4: Request FREE SSL Certificate from AWS ACM

### 4.1 Go to Certificate Manager

1. **IMPORTANT:** Switch to **US East (N. Virginia)** region in top-right
   - Or use your EC2's region
2. Search for **"Certificate Manager"** (ACM)
3. Click **"Request a certificate"**

### 4.2 Request Certificate

1. Choose **"Request a public certificate"**
2. Click **"Next"**

### 4.3 Enter Domain Names

Add both these domains (for flexibility):

```
portal.esgportal.com
*.esgportal.com
```

**Why wildcard (`*`):** Allows any subdomain (portal, api, admin, etc.)

Click **"Next"**

### 4.4 Select Validation Method

Choose **"DNS validation"**  
Click **"Next"**

### 4.5 Add Tags (Optional)

```
Key: Name
Value: ESG Portal Certificate
```

Click **"Request"**

### 4.6 Validate Domain Ownership

1. Click **"View certificate"**
2. You'll see validation status: **Pending validation**
3. Click **"Create records in Route 53"** button
4. Click **"Create records"**

**AWS automatically adds CNAME records to Route 53 for validation.**

**Wait 5-10 minutes** - Status will change to **"Issued"** ✅

Refresh page to check status.

---

## Step 5: Update EC2 Security Group

Ensure ports 80 and 443 are open:

1. Go to **EC2** → **Security Groups**
2. Select your EC2's security group
3. **Inbound rules** should have:

```
Type: HTTP       Port: 80     Source: 0.0.0.0/0
Type: HTTPS      Port: 443    Source: 0.0.0.0/0
Type: SSH        Port: 22     Source: Your-IP
Type: Custom TCP Port: 3000   Source: 127.0.0.1/32  (localhost only)
```

---

## Step 6: SSH to EC2 and Update Configuration

### 6.1 Connect to EC2

```bash
ssh -i your-key.pem ubuntu@51.112.164.164
```

### 6.2 Stop and Remove DuckDNS Cron Job

```bash
# Remove cron job
crontab -e
```

**Delete these lines:**
```
*/5 * * * * ~/duckdns/duck.sh >/dev/null 2>&1
*/10 * * * * ~/duckdns/check-dns.sh
```

Save and exit.

**Optional:** Remove DuckDNS directory
```bash
rm -rf ~/duckdns
```

### 6.3 Install Certbot for Let's Encrypt

**Wait, why not use ACM certificate?**
- ACM certificates only work with AWS Load Balancers/CloudFront
- For direct EC2 + Nginx, use **Let's Encrypt** (still free!)

```bash
sudo apt update
sudo apt install certbot python3-certbot-nginx -y
```

### 6.4 Get SSL Certificate from Let's Encrypt

Replace `portal.esgportal.com` with your actual domain:

```bash
sudo certbot --nginx -d portal.esgportal.com -d esgportal.com --email bullhunter6@gmail.com --agree-tos --no-eff-email
```

**Note:** Add both `portal.esgportal.com` and root `esgportal.com` if you want both to work.

When asked about redirecting HTTP to HTTPS, choose **2** (Yes, redirect).

You should see:
```
Successfully received certificate.
Certificate is saved at: /etc/letsencrypt/live/portal.esgportal.com/fullchain.pem
Key is saved at: /etc/letsencrypt/live/portal.esgportal.com/privkey.pem
```

### 6.5 Update Nginx Configuration

Certbot should auto-configure Nginx. Verify:

```bash
sudo nano /etc/nginx/sites-available/portal
```

Should look like this:

```nginx
server {
    listen 80;
    server_name portal.esgportal.com esgportal.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name portal.esgportal.com esgportal.com;

    # Let's Encrypt SSL certificate
    ssl_certificate /etc/letsencrypt/live/portal.esgportal.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/portal.esgportal.com/privkey.pem;

    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
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

**If Certbot didn't auto-configure**, manually update the domain names and certificate paths.

Test Nginx:
```bash
sudo nginx -t
```

Reload Nginx:
```bash
sudo systemctl reload nginx
```

### 6.6 Test Auto-Renewal

```bash
sudo certbot renew --dry-run
```

Should show:
```
Congratulations, all simulated renewals succeeded
```

---

## Step 7: Update Portal Environment Variables

### 7.1 Update .env File

```bash
cd /var/www/current
nano .env
```

Update these lines (replace with your actual domain):
```bash
NEXTAUTH_URL="https://portal.esgportal.com"
APP_URL="https://portal.esgportal.com"
```

Save and exit (Ctrl+X, Y, Enter).

### 7.2 Copy to Apps Directory

```bash
cp .env apps/web/.env
```

### 7.3 Restart Portal

```bash
pm2 restart all
```

### 7.4 Verify Portal is Running

```bash
pm2 status
pm2 logs portal-v1.0.5 --lines 20
```

---

## Step 8: Test Your New Domain!

### 8.1 Test HTTPS

Open in browser:
```
https://portal.esgportal.com/esg
```

You should see:
- ✅ Green padlock 🔒
- ✅ "Secure" in address bar
- ✅ No browser warnings
- ✅ Your portal loads correctly

### 8.2 Test HTTP Redirect

```
http://portal.esgportal.com/esg
```

Should automatically redirect to HTTPS.

### 8.3 Test Login

1. Go to `https://portal.esgportal.com/signin`
2. Log in with your credentials
3. Verify session works
4. Check admin panel: `https://portal.esgportal.com/admin`

---

## Step 9: Clean Up Old DuckDNS Certificate

### 9.1 Remove Old Certificate

```bash
sudo certbot delete --cert-name unifiedportal.duckdns.org
```

Choose **Yes** when asked to delete.

### 9.2 Remove Old Nginx Config (Optional)

If you have a backup config for DuckDNS:
```bash
sudo rm -f /etc/nginx/sites-available/portal.bak
```

---

## Step 10: Update Documentation & Share New URL

### 10.1 Update DEPLOYMENT_GUIDE.md

Update all references from:
- ❌ `http://51.112.164.164:3000`
- ❌ `https://unifiedportal.duckdns.org`

To:
- ✅ `https://portal.esgportal.com`

### 10.2 Share New URL with Users

**Your new professional URLs:**
```
Main Site:    https://portal.esgportal.com
ESG Articles: https://portal.esgportal.com/esg
Credit:       https://portal.esgportal.com/credit
Admin Panel:  https://portal.esgportal.com/admin
AI Assistant: https://portal.esgportal.com/esg/article-assistant
```

---

## 🎉 Migration Complete!

### What You Now Have:

✅ **Professional domain** - `portal.esgportal.com`  
✅ **Trusted SSL** - Let's Encrypt certificate  
✅ **Auto-renewal** - Certificate renews automatically  
✅ **99.99% uptime** - AWS Route 53 reliability  
✅ **Zero maintenance** - No cron jobs needed  
✅ **Production ready** - Enterprise-grade DNS  

### What You Eliminated:

❌ DuckDNS cron job maintenance  
❌ DNS resolution failures  
❌ Free subdomain limitations  
❌ Manual updates every 5 minutes  
❌ Potential downtime  

---

## 💰 Cost Breakdown

| Item | Cost | Frequency |
|------|------|-----------|
| Domain registration | $12 | Per year |
| Route 53 hosted zone | $0.50 | Per month |
| Route 53 queries | ~$0.10 | Per month |
| SSL certificate | $0 | Free (Let's Encrypt) |
| **TOTAL** | **$18/year** | **= $1.50/month** |

**ROI:** Prevent one DNS outage = Worth it!

---

## 🔍 Troubleshooting

### Domain doesn't resolve

**Check DNS propagation:**
```bash
nslookup portal.esgportal.com
```

**Check Route 53 record:**
- Go to Route 53 → Hosted zones
- Verify A record points to correct IP
- TTL should be 300 seconds

**Wait:** DNS changes take 5-30 minutes globally.

### SSL certificate not working

**Check Certbot:**
```bash
sudo certbot certificates
```

**Re-run Certbot:**
```bash
sudo certbot --nginx -d portal.esgportal.com --force-renewal
```

### Login doesn't work

**Check environment variables:**
```bash
cd /var/www/current
grep NEXTAUTH_URL .env apps/web/.env
```

Both should show your new domain.

**Restart portal:**
```bash
pm2 restart all
```

### Nginx error

**Test config:**
```bash
sudo nginx -t
```

**Check logs:**
```bash
sudo tail -f /var/log/nginx/error.log
```

---

## 📊 Before vs After Comparison

| Aspect | DuckDNS | Route 53 |
|--------|---------|----------|
| **URL** | unifiedportal.duckdns.org | portal.esgportal.com |
| **Cost** | $0 | $1.50/month |
| **Reliability** | 95% | 99.99% |
| **Maintenance** | Manual cron job | Zero |
| **Professional** | ⚠️ Subdomain | ✅ Custom domain |
| **Outages** | Possible | Extremely rare |
| **SSL** | Let's Encrypt | Let's Encrypt |
| **Best for** | Testing | Production |

---

## 🎯 Next Steps After Migration

1. ✅ Test all features thoroughly
2. ✅ Update any hardcoded URLs in your app
3. ✅ Share new URL with users
4. ✅ Update bookmarks
5. ✅ Consider adding email (contact@esgportal.com) via AWS SES
6. ✅ Set up CloudWatch monitoring
7. ✅ Delete DuckDNS account (optional)

---

## 🔐 Security Status: 10/10! 🎉

With Route 53, you've achieved:
- ✅ Professional domain
- ✅ Trusted SSL certificate
- ✅ 99.99% DNS uptime
- ✅ Zero maintenance required
- ✅ Enterprise-grade infrastructure

**Your portal is now truly production-ready!** 🚀

---

## Quick Reference Commands

```bash
# Check DNS
nslookup portal.esgportal.com

# Check SSL certificate
sudo certbot certificates

# Test SSL renewal
sudo certbot renew --dry-run

# Restart portal
pm2 restart all

# View portal logs
pm2 logs portal-v1.0.5

# Test Nginx config
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

---

**Questions?** Follow each step carefully and you'll have a professional domain in ~40 minutes!
