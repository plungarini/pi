#!/usr/bin/env bash
# verify_dns.sh — simple tests to confirm DNS and Proxy setup

set -u

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo "=== DNS & Proxy Verification ==="
echo ""

# 1. Check services from services.json
if [[ ! -f "services.json" ]]; then
    echo "ERROR: services.json not found."
    exit 1
fi

PI_IP=$(jq -r '.pi_ip' services.json)
echo "Pi IP: $PI_IP"
echo ""

check_dns() {
    local domain=$1
    local expected_ip=$2
    local description=$3

    echo -n "Checking $description ($domain)... "
    result=$(dig +short "@localhost" "$domain" || echo "ERROR")
    
    if [[ "$result" == "$expected_ip" ]]; then
        echo -e "${GREEN}PASS${NC} (resolved to $result)"
    elif [[ -z "$result" && "$expected_ip" == "NXDOMAIN" ]]; then
        # dig +short returns empty for NXDOMAIN
        echo -e "${GREEN}PASS${NC} (NXDOMAIN as expected)"
    else
        echo -e "${RED}FAIL${NC} (got '$result', expected '$expected_ip')"
    fi
}

# Test registered services
while IFS= read -r domain; do
    check_dns "$domain" "$PI_IP" "Registered domain"
done < <(jq -r '.services[].domain' services.json)

# Test NXDOMAIN for unregistered .pi
check_dns "this-should-not-exist.pi" "NXDOMAIN" "Unregistered .pi domain"

# 2. Check Caddy (localhost)
echo ""
echo "Checking Caddy Proxy (local)..."
while IFS= read -r domain; do
    echo -n "Checking $domain... "
    status=$(curl -o /dev/null -s -w "%{http_code}" -H "Host: $domain" http://localhost || echo "ERR")
    if [[ "$status" =~ ^(200|301|302|307|308|401|403|404)$ ]]; then
        # Any response code means the proxy is listening and routing (404 might be from the backend app)
        echo -e "${GREEN}PASS${NC} (HTTP $status)"
    else
        echo -e "${RED}FAIL${NC} (HTTP $status)"
    fi
done < <(jq -r '.services[].domain' services.json)

echo ""
echo "Verification complete."
