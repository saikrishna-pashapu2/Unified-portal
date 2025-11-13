# DuckDNS Monitoring & Reliability Guide

## 🚨 Problem: DNS Outages

DuckDNS requires your server to send updates every 5 minutes. If updates stop, your domain disappears after ~30 minutes.

---

## ✅ Solution 1: Verify Cron Job is Running (CRITICAL)

### Step 1: Check if Cron Job Exists

SSH to your EC2:
```bash
ssh -i your-key.pem ubuntu@YOUR_EC2_IP
crontab -l
```

**Should show:**
```
*/5 * * * * ~/duckdns/duck.sh >/dev/null 2>&1
```

**If empty:** Your cron job was deleted! Re-add it:
```bash
crontab -e
```

Add this line:
```
*/5 * * * * ~/duckdns/duck.sh >/dev/null 2>&1
```

Save and exit.

---

### Step 2: Verify Update Script Works

```bash
cd ~/duckdns
./duck.sh
cat duck.log
```

**Should show:** `OK`

**If shows "KO":** Your token is invalid or domain is wrong.

**Fix:**
```bash
nano ~/duckdns/duck.sh
```

Verify it looks like this:
```bash
#!/bin/bash
echo url="https://www.duckdns.org/update?domains=unifiedportal&token=YOUR_ACTUAL_TOKEN&ip=" | curl -k -o ~/duckdns/duck.log -K -
```

Replace `YOUR_ACTUAL_TOKEN` with your real DuckDNS token.

---

### Step 3: Check Cron Service is Running

```bash
sudo systemctl status cron
```

**Should show:** `active (running)`

**If not running:**
```bash
sudo systemctl enable cron
sudo systemctl start cron
```

---

## ✅ Solution 2: Add Monitoring & Alerts

### Create Health Check Script

```bash
nano ~/duckdns/check-dns.sh
```

Paste this:
```bash
#!/bin/bash

DOMAIN="unifiedportal.duckdns.org"
EXPECTED_IP="51.112.164.164"  # Replace with your EC2 IP

# Get current IP from DNS
CURRENT_IP=$(dig +short $DOMAIN @8.8.8.8 | tail -n1)

# Log timestamp
DATE=$(date '+%Y-%m-%d %H:%M:%S')

if [ "$CURRENT_IP" != "$EXPECTED_IP" ]; then
    echo "[$DATE] ❌ DNS FAILURE: $DOMAIN resolves to '$CURRENT_IP' instead of '$EXPECTED_IP'" >> ~/duckdns/dns-health.log
    
    # Force update DuckDNS
    ~/duckdns/duck.sh
    
    echo "[$DATE] 🔄 Forced DuckDNS update" >> ~/duckdns/dns-health.log
else
    echo "[$DATE] ✅ DNS OK: $DOMAIN -> $CURRENT_IP" >> ~/duckdns/dns-health.log
fi
```

Make executable:
```bash
chmod +x ~/duckdns/check-dns.sh
```

Test it:
```bash
./check-dns.sh
cat ~/duckdns/dns-health.log
```

---

### Add to Crontab (Run Every 10 Minutes)

```bash
crontab -e
```

Add this line (below the existing DuckDNS update line):
```
*/10 * * * * ~/duckdns/check-dns.sh
```

Now you'll have:
```
*/5 * * * * ~/duckdns/duck.sh >/dev/null 2>&1
*/10 * * * * ~/duckdns/check-dns.sh
```

This checks DNS health every 10 minutes and auto-fixes issues.

---

## ✅ Solution 3: Email Alerts on DNS Failure

### Install Mail Utility

```bash
sudo apt update
sudo apt install mailutils -y
```

### Create Alert Script

```bash
nano ~/duckdns/alert-on-failure.sh
```

Paste this:
```bash
#!/bin/bash

DOMAIN="unifiedportal.duckdns.org"
EXPECTED_IP="51.112.164.164"  # Your EC2 IP
ALERT_EMAIL="bullhunter6@gmail.com"  # Your email

CURRENT_IP=$(dig +short $DOMAIN @8.8.8.8 | tail -n1)
DATE=$(date '+%Y-%m-%d %H:%M:%S')

if [ "$CURRENT_IP" != "$EXPECTED_IP" ]; then
    # Send email alert
    echo "DNS FAILURE DETECTED at $DATE

Domain: $DOMAIN
Expected IP: $EXPECTED_IP
Current IP: $CURRENT_IP

The DuckDNS update has been forced automatically.
Check logs: ~/duckdns/dns-health.log

Server: $(hostname)" | mail -s "🚨 Portal DNS Failure Alert" $ALERT_EMAIL
    
    # Force update
    ~/duckdns/duck.sh
    
    echo "[$DATE] 🚨 ALERT SENT: DNS failure detected and fixed" >> ~/duckdns/dns-health.log
fi
```

Make executable:
```bash
chmod +x ~/duckdns/alert-on-failure.sh
```

Update crontab:
```bash
crontab -e
```

Replace the check-dns line with:
```
*/10 * * * * ~/duckdns/alert-on-failure.sh
```

---

## ✅ Solution 4: Use AWS Route 53 (Recommended for Production)

**Problem with DuckDNS:**
- ⚠️ Requires constant updates
- ⚠️ Free service = less reliability
- ⚠️ No SLA or guarantee
- ⚠️ Can go down without notice

**AWS Route 53 Alternative:**
- ✅ $0.50/month per domain
- ✅ 100% uptime SLA
- ✅ No update scripts needed
- ✅ Enterprise-grade DNS
- ✅ Auto-failover support

### Quick Setup:

1. **Buy domain on Route 53** (~$12/year)
2. **Create hosted zone** (auto-created)
3. **Add A record:**
   ```
   Name: portal.yourdomain.com
   Type: A
   Value: 51.112.164.164
   TTL: 300
   ```
4. **Request SSL from ACM** (AWS Certificate Manager - FREE)
5. **Update Nginx config** to use new domain
6. **Done!** No cron jobs, no maintenance

**Cost:** $1/month + $12/year domain = **$2/month total**

---

## 🔍 Debugging DNS Issues

### Check DNS Resolution Locally

```bash
# From your EC2
dig unifiedportal.duckdns.org

# Should show:
# ;; ANSWER SECTION:
# unifiedportal.duckdns.org. 60 IN A 51.112.164.164
```

### Check DuckDNS Update Log

```bash
cat ~/duckdns/duck.log
```

**Should show:** `OK`  
**If shows:** `KO` - Token or domain name is wrong

### Check Cron Logs

```bash
grep CRON /var/log/syslog | tail -20
```

Should show your duck.sh script running every 5 minutes.

### Manual Force Update

```bash
cd ~/duckdns
./duck.sh
cat duck.log
```

If shows `OK`, wait 2 minutes and test:
```bash
dig unifiedportal.duckdns.org
```

---

## 📊 Root Cause Analysis

### Why Your DNS Failed:

1. **Most Likely Cause:** Cron job stopped running
   - Server reboot didn't restore crontab
   - Crontab got cleared accidentally
   - User changed (running as wrong user)

2. **Other Possible Causes:**
   - DuckDNS token expired
   - Network issue prevented updates
   - DuckDNS service temporary outage
   - Wrong domain name in script

---

## 🎯 Production-Ready Checklist

For **reliable production deployment**, ensure:

- [ ] **Cron job verified** - `crontab -l` shows duck.sh
- [ ] **Update script works** - `./duck.sh && cat duck.log` shows "OK"
- [ ] **Cron service running** - `systemctl status cron` is active
- [ ] **DNS health monitoring** - Check script running every 10 minutes
- [ ] **Email alerts configured** - Get notified of failures
- [ ] **Log rotation** - Prevent logs from filling disk
- [ ] **Backup DNS option** - Consider Route 53 for critical production

---

## 💡 Recommended Approach

### For Testing/Development:
✅ **DuckDNS** (free, good enough)

### For Production:
✅ **AWS Route 53** ($1/month)
- No maintenance
- 100% reliability
- Professional domain
- AWS integrated

---

## 🚀 Quick Fix Right Now

Run these commands on your EC2 to ensure it won't happen again:

```bash
# Verify cron job exists
crontab -l

# If empty, add it:
crontab -e
# Add: */5 * * * * ~/duckdns/duck.sh >/dev/null 2>&1

# Test update manually
cd ~/duckdns
./duck.sh
cat duck.log  # Should show "OK"

# Verify DNS
dig unifiedportal.duckdns.org  # Should show your IP

# Enable cron service
sudo systemctl enable cron
sudo systemctl start cron
```

---

## 📞 When to Upgrade to Route 53

Upgrade if you experience:
- ❌ DNS outages more than once/month
- ❌ Users can't access your site randomly
- ❌ SSL renewal failures due to DNS
- ❌ Need 99.9%+ uptime guarantee
- ❌ Running production business application

**Cost-benefit:** $2/month for peace of mind is worth it for production.

---

**Next Steps:**
1. Verify your cron job is running (above commands)
2. Add monitoring script (optional but recommended)
3. Consider Route 53 for production stability
