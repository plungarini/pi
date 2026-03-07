#!/usr/bin/env bash
# install.sh — one-time setup for local DNS + Caddy reverse proxy on the Pi
# Run once as a user with sudo. Idempotent (safe to re-run).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICES_FILE="$SCRIPT_DIR/services.json"

echo "=== Pi Local DNS + Proxy Setup ==="
echo ""

CURRENT_IP=$(hostname -I | awk '{print $1}')
echo "Detected Pi LAN IP: $CURRENT_IP"
echo ""
echo "IMPORTANT: This should match 'pi_ip' in services.json."
echo "Current services.json pi_ip: $(jq -r '.pi_ip' "$SERVICES_FILE")"
echo ""
read -rp "Update services.json pi_ip to $CURRENT_IP? [Y/n] " CONFIRM
if [[ "${CONFIRM:-Y}" =~ ^[Yy]$ ]]; then
  TMPFILE=$(mktemp)
  jq --arg ip "$CURRENT_IP" '.pi_ip = $ip' "$SERVICES_FILE" > "$TMPFILE"
  mv "$TMPFILE" "$SERVICES_FILE"
  echo "Updated pi_ip to $CURRENT_IP in services.json"
fi
echo ""

echo "Installing dnsmasq, caddy, jq..."
sudo apt-get update -qq
sudo apt-get install -y dnsmasq jq

if ! command -v caddy &>/dev/null; then
  echo "Installing Caddy..."
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | sudo tee /etc/apt/sources.list.d/caddy-stable.list
  sudo apt-get update -qq
  sudo apt-get install -y caddy
else
  echo "Caddy already installed: $(caddy version)"
fi
echo ""

echo "Configuring dnsmasq..."
if systemctl is-active --quiet systemd-resolved 2>/dev/null; then
  sudo sed -i 's/#DNSStubListener=yes/DNSStubListener=no/' /etc/systemd/resolved.conf
  sudo systemctl restart systemd-resolved
  echo "Disabled systemd-resolved stub listener"
fi

sudo mkdir -p /etc/dnsmasq.d
sudo cp "$SCRIPT_DIR/dnsmasq.conf" /etc/dnsmasq.d/pi-local.conf
sudo systemctl enable dnsmasq
sudo systemctl restart dnsmasq
echo "dnsmasq configured and running"
echo ""

echo "Configuring Caddy..."
sudo mkdir -p /etc/caddy
bash "$SCRIPT_DIR/apply.sh"
sudo systemctl enable caddy
echo "Caddy configured and running"
echo ""

echo "==================================================="
echo "  ACTION REQUIRED: Set a static IP for this Pi"
echo "==================================================="
echo ""
echo "Add a DHCP reservation in your router for:"
echo "  MAC: $(ip link show | grep -E 'ether [a-f0-9]{2}:' | head -1 | awk '{print $2}')"
echo "  IP:  $CURRENT_IP"
echo ""
echo "==================================================="
echo "  Next step: Configure your iPhone DNS"
echo "==================================================="
echo ""
echo "  Settings → Wi-Fi → tap your network → Configure DNS"
echo "  → Manual → delete existing → Add server: $CURRENT_IP"
echo ""
echo "Done! Run ./apply.sh any time you edit services.json."