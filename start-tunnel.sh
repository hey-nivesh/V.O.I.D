#!/bin/bash
# ============================================
# VOID Cloudflare Tunnel Launcher (macOS)
# ============================================
# Starts a Cloudflare tunnel for the Admin Dashboard
# so an external reviewer can access it via a public URL.
#
# Usage: ./start-tunnel.sh [port]
# Default port: 8080 (admin dashboard)
# ============================================

PORT="${1:-8080}"

echo "☁️  VOID Cloudflare Tunnel Launcher"
echo "===================================="
echo ""

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
    echo "❌ cloudflared is not installed."
    echo ""
    echo "Install it with:"
    echo "  brew install cloudflared"
    echo ""
    echo "Or download from:"
    echo "  https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/"
    exit 1
fi

echo "✅ cloudflared found: $(cloudflared --version 2>&1 | head -1)"
echo ""
echo "🚀 Starting tunnel for localhost:${PORT}..."
echo "   Look for the URL ending in .trycloudflare.com below!"
echo ""

cloudflared tunnel --url "http://localhost:${PORT}"
