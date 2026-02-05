#!/bin/bash
# Fix Prisma client sync issues on EC2
# Run this script on your EC2 instance to regenerate Prisma clients

echo "🔧 Fixing Prisma client on EC2..."

# Navigate to project directory
cd /home/ubuntu/Portal_v3 || cd ~/Portal_v3 || exit 1

echo "📦 Installing dependencies..."
pnpm install

echo "🔄 Generating Prisma clients..."
cd packages/db-esg
pnpm prisma generate
cd ../..

cd packages/db-credit
pnpm prisma generate
cd ../..

echo "🏗️  Building the project..."
cd apps/web
pnpm build

echo "🔄 Restarting PM2..."
pm2 restart all

echo "✅ Done! Check logs with: pm2 logs"
