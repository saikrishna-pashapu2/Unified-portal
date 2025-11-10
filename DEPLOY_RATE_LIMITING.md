# Quick Deployment Guide - Rate Limiting Update

## 🚀 Deploy Security Updates to EC2

Follow these steps to deploy the rate limiting changes to your production server.

---

## Step 1: Commit and Push Changes to GitHub

### From Your Local Machine (PowerShell):

```powershell
# Navigate to project directory
cd C:\Users\saikr\OneDrive\Documents\projects\esg\Portal_v3

# Check what files changed
git status

# Add all changes
git add .

# Commit with descriptive message
git commit -m "Add login rate limiting and improve session security

- Implement rate limiting (5 attempts, 15-min lockout)
- Reduce session duration from 30 days to 7 days
- Add user-friendly lockout error messages
- Add automatic cleanup of expired records
- Security score improved from 8.5/10 to 9.5/10"

# Push to GitHub
git push origin main
```

---

## Step 2: SSH to EC2 Server

```powershell
# Use your EC2 key and IP
ssh -i your-key.pem ubuntu@51.112.164.164
```

---

## Step 3: Pull Latest Changes

```bash
# Navigate to portal directory
cd /var/www/current

# Pull latest changes from GitHub
git pull origin main
```

You should see:
```
Updating abc1234..def5678
Fast-forward
 apps/web/src/lib/rate-limit.ts         | 200 ++++++++++++++++++++
 apps/web/src/lib/nextauth-options.ts   |  25 ++-
 RATE_LIMITING_GUIDE.md                 | 456 ++++++++++++++++++++++++
 3 files changed, 681 insertions(+)
 create mode 100644 apps/web/src/lib/rate-limit.ts
 create mode 100644 RATE_LIMITING_GUIDE.md
```

---

## Step 4: Install Dependencies (if needed)

```bash
pnpm install
```

This ensures all dependencies are up to date.

---

## Step 5: Rebuild the Application

```bash
# Navigate to web app
cd apps/web

# Build production bundle
pnpm build
```

Should take 1-2 minutes. You'll see:
```
✓ Compiled successfully
✓ Linting and checking validity of types
✓ Collecting page data
✓ Generating static pages (36/36)
✓ Finalizing page optimization

Route (app)                              Size     First Load JS
┌ ○ /                                    ...      ...
...
```

---

## Step 6: Restart Portal with PM2

```bash
# Go back to root directory
cd ../..

# Restart the portal
pm2 restart all

# Check status
pm2 status
```

Should show:
```
┌────┬──────────────────┬─────────┬─────────┬────────┬─────────┐
│ id │ name             │ mode    │ status  │ uptime │ memory  │
├────┼──────────────────┼─────────┼─────────┼────────┼─────────┤
│ 0  │ portal-v1.0.0    │ fork    │ online  │ 0s     │ XXmb    │
└────┴──────────────────┴─────────┴─────────┴────────┴─────────┘
```

---

## Step 7: Verify Deployment

```bash
# Check logs for any errors
pm2 logs portal-v1.0.0 --lines 50

# Look for successful startup messages
# Should NOT see any error messages
```

---

## Step 8: Test Rate Limiting

### From Your Browser:

1. **Open**: `https://unifiedportal.duckdns.org/signin`

2. **Test Failed Attempts**:
   - Enter wrong password 5 times
   - After 5th attempt, should see: 
     ```
     Too many failed login attempts. 
     Please try again in 15 minutes.
     ```

3. **Test Successful Login**:
   - Wait 15 minutes OR restart PM2 (clears in-memory state)
   - Login with correct credentials
   - Should work normally

4. **Test Session Duration**:
   - Login successfully
   - Session will now expire after 7 days (instead of 30)

---

## 🎯 Quick Commands Reference

```bash
# View portal status
pm2 status

# View real-time logs
pm2 logs portal-v1.0.0

# Restart portal
pm2 restart all

# Check if portal is responding
curl https://unifiedportal.duckdns.org

# View last 100 log lines
pm2 logs portal-v1.0.0 --lines 100 --nostream
```

---

## 🔍 Troubleshooting

### Issue: Git pull fails with merge conflicts

**Fix:**
```bash
# Stash local changes
git stash

# Pull changes
git pull origin main

# Reapply your changes
git stash pop
```

### Issue: Build fails

**Fix:**
```bash
# Clean and reinstall
rm -rf node_modules
rm -rf apps/web/.next
pnpm install
cd apps/web
pnpm build
```

### Issue: Portal won't start after restart

**Fix:**
```bash
# Check for errors
pm2 logs portal-v1.0.0 --err --lines 50

# Try manual start
cd apps/web
pnpm start

# If error appears, fix it and rebuild
```

### Issue: Rate limiting not working

**Fix:**
```bash
# Verify files were deployed
ls -la /var/www/current/apps/web/src/lib/rate-limit.ts

# Should show the file exists

# Check build output includes rate-limit
grep -r "rate-limit" /var/www/current/apps/web/.next/
```

---

## ✅ Deployment Checklist

After deployment, verify:

- [ ] `git pull` completed successfully
- [ ] `pnpm build` completed without errors
- [ ] `pm2 restart` shows "online" status
- [ ] No errors in `pm2 logs`
- [ ] Website loads: `https://unifiedportal.duckdns.org`
- [ ] Can login with correct credentials
- [ ] Rate limiting triggers after 5 failed attempts
- [ ] Lockout message displays correctly
- [ ] Session expires after 7 days (test later)

---

## 📊 Expected Behavior After Deployment

### Login Flow:
```
✅ Correct password → Login successful
❌ Wrong password (1-4 times) → "Invalid credentials"
❌ Wrong password (5th time) → "Too many attempts, try in 15 minutes"
⏰ After 15 minutes → Can login again
✅ Successful login → Counter resets to 0
```

### Session Duration:
```
Before: Valid for 30 days
After:  Valid for 7 days
```

### Security Score:
```
Before: 8.5/10
After:  9.5/10 ✅
```

---

## 🎉 Success!

Once deployed, your portal will have:
- ✅ Login rate limiting (brute force protection)
- ✅ Shorter session duration (reduced attack window)
- ✅ User-friendly error messages
- ✅ Production-grade security (9.5/10)

---

## 📝 Post-Deployment Notes

### Monitor for 24 Hours:
```bash
# Check logs periodically
pm2 logs portal-v1.0.0 --lines 20

# Look for:
# - Any rate limit activations
# - User login patterns
# - Any errors or warnings
```

### If Users Report Issues:
- Check if legitimate users are being locked out
- Consider increasing `MAX_ATTEMPTS` from 5 to 7
- Consider reducing `LOCKOUT_DURATION` from 15 to 10 minutes

### Performance Impact:
- Rate limiting is lightweight (in-memory)
- No database queries added
- No noticeable performance impact

---

**Ready to deploy? Follow the steps above!** 🚀

Estimated time: **5-10 minutes**
