# Pi Infrastructure

Infrastructure configuration for the Raspberry Pi, including local DNS resolution and reverse proxy setup.

## Goal

The goal is to provide **local-network-only DNS** so Pi services can be accessed by human-readable names (e.g., `http://reddit.pi`) from devices on the local network (like your iPhone), without exposing anything to the internet.

## Components

- **dnsmasq**: DNS server that resolves `.pi` domains to the Pi's local IP.
- **Caddy**: Reverse proxy that routes incoming traffic to the correct local port based on the hostname.
- **services.json**: The single source of truth for domain-to-port mappings.

## Quick Start

Run the following commands on your Raspberry Pi:

```bash
cd ~/pi/infra-pi/dns
chmod +x install.sh apply.sh
./install.sh
```

## Maintenance

Whenever you add or change a service in `dns/services.json`, run:

```bash
cd ~/pi/infra-pi/dns
./apply.sh
```

## Verification

You can verify the setup using the provided script:

```bash
cd ~/pi/infra-pi/dns
./verify_dns.sh
```
