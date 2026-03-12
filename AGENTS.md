# Pi Projects - Agent Guide

This document provides comprehensive guidance for AI coding agents working on the Pi Projects ecosystem. The Pi Projects is a collection of microservices designed to run on Raspberry Pi, providing various automation and AI capabilities.

## Project Overview

The Pi Projects is a monorepo-organized collection of independent microservices that work together to provide:

- **Centralized Logging** (`logger-pi`): Log ingestion service that other services stream logs to
- **Reddit Intelligence** (`reddit-pi`): Recommendation engine with AI-powered content scoring
- **WhatsApp Bridge** (`whatsapp-pi`): WhatsApp API for programmatic messaging
- **Vector Memory** (`memory-pi`): Semantic memory storage using vector embeddings
- **Medical AI Assistant** (`medical-pi`): MedGemma-powered medical chat with breathing profile
- **Nest Hub Display** (`nesthub-pi`): Custom Google Nest Hub display with Cast protocol
- **Infrastructure** (`infra-pi`): DNS and reverse proxy configuration for local network access

The repository uses **Git Submodules** for independent service development with shared release management.

## Repository Structure

```
pi/
├── package.json              # Root package with orchestration scripts
├── .gitmodules               # Submodule definitions
├── README.md                 # Human-facing documentation
├── SUB_PROJECT_GUIDELINES.md # Standards for new sub-projects
├── walkthrough.md           # memory-pi implementation notes
├── scripts/                 # Root-level automation scripts
│   ├── build-update.js      # Git flow release automation (developer)
│   └── update.js            # Production update script
├── infra-pi/                # DNS + reverse proxy infrastructure
│   └── dns/                 # dnsmasq + Caddy configuration
├── logger-pi/               # Central logging service (port 4000)
├── reddit-pi/               # Reddit recommendation engine (port 3000)
├── whatsapp-pi/             # WhatsApp API bridge (port 3001)
├── memory-pi/               # Vector memory microservice (port 3002)
├── medical-pi/              # Medical AI assistant (port 3003)
└── nesthub-pi/              # Nest Hub display service (port 3000)
```

Each submodule is an independent Git repository linked via submodules.

## Technology Stack

### Runtime & Language
- **Node.js** with **TypeScript**
- **ES Modules** (`"type": "module"` in package.json)
- **Target**: ES2022
- **Module Resolution**: NodeNext (modern ESM)

### Common Dependencies Across Services
- **Fastify**: Web framework for API services
- **better-sqlite3**: SQLite database (embedded)
- **node-cron**: Background job scheduling
- **pino / pino-pretty**: Structured logging

### Service-Specific Technologies

**logger-pi**:
- Minimal footprint, fire-and-forget log ingestion
- Simple file-based log storage with rotation

**reddit-pi**:
- **React + Vite + TailwindCSS**: Admin UI
- **@xenova/transformers**: Local embeddings
- **Puppeteer**: Cookie extraction for Reddit auth
- **SQLite**: Content and preference storage

**whatsapp-pi**:
- **@whiskeysockets/baileys**: WhatsApp Web API
- **qrcode-terminal**: QR code display for auth
- **sqlite-vec**: Optional vector search for message history

**memory-pi**:
- **sqlite-vec**: Native vector storage (no external DB)
- **ollama**: Local embeddings (`nomic-embed-text`)
- **OpenRouter**: LLM for multimodal distillation (Gemini 2.0)
- **Zod**: Schema validation
- **React + Vite**: Admin UI with glassmorphic design

**medical-pi**:
- **MedGemma 4B via Modal**: Primary medical inference model
- **OpenRouter**: Utility LLM for profile extraction and titles
- **Meilisearch**: Full-text search for messages and documents
- **better-sqlite3**: Medical profile and conversation storage
- **React + Vite + TailwindCSS**: Chat UI with streaming messages
- **Zod**: Profile diff validation

**nesthub-pi**:
- **Fastify**: Web framework
- **castv2**: Google Cast protocol
- **node-dns-sd**: mDNS discovery
- **cloudflared**: Secure tunnels

## Build and Development Commands

### Cloning the Repository

```bash
# Initial clone with all submodules
git clone --recurse-submodules git@github.com:plungarini/pi.git

# If already cloned without submodules
git submodule update --init --recursive
```

### Root-Level Commands

```bash
# Development: Automate releases across all submodules
npm run build-update

# Production: Update all services to latest master
npm run update
```

### Service-Level Commands (applies to each submodule)

```bash
cd <service-name>

# Install dependencies
npm install

# Build TypeScript
npm run build

# Start production server
npm start

# Development mode (varies by service)
npm run dev

# Interactive environment setup
npm run onboard

# Run tests
npm test

# Type checking
npm run typecheck
```

### Service Startup Order

**Important**: Start services in this order:
1. `logger-pi` (port 4000) - Must be running before other services
2. `memory-pi` (port 3002) - If using semantic memory features
3. `whatsapp-pi` (port 3001) - If using WhatsApp notifications
4. `reddit-pi` (port 3000) - Depends on logger and optionally WhatsApp
5. `medical-pi` (port 3003) - Depends on logger, optionally memory-pi and whatsapp-pi
6. `nesthub-pi` (port 3000) - Depends on logger and Cloudflare

## Code Organization

### Standard Directory Structure (for sub-projects)

```
src/
├── api/                     # Public interface
│   ├── routes/             # Route definitions
│   └── server.ts           # Server setup
├── core/                   # Infrastructure & shared modules
│   ├── logger.ts          # logger-pi integration
│   └── ...
├── services/              # Business logic
├── types/                 # Shared TypeScript types
├── tests/                 # Unit and integration tests
└── index.ts               # Application entry point
```

### TypeScript Configuration

All projects use strict TypeScript with ESM:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

### Logger Integration Pattern

Every sub-project (except `logger-pi` itself) must implement a `src/logger.ts` that:
- Intercepts native `console` methods
- Batches logs locally (500ms flush interval)
- Sends asynchronously to `logger-pi` at `http://127.0.0.1:4000/logs`
- Attaches `projectId` to identify the source
- Handles graceful shutdown with buffer flush

See `reddit-pi/src/logger.ts` for the reference implementation.

### Environment Configuration

- `.env.example`: Template with all required variables (committed)
- `.env`: Actual configuration (gitignored)
- Onboarding scripts (`scripts/onboard.js`) interactively populate `.env`

## Testing Strategy

### Test Framework
- **Vitest** for unit and integration testing
- Tests located in `src/tests/` or `tests/` depending on service

### Running Tests
```bash
npm test           # Run once
npm run test:watch # Run in watch mode (if configured)
```

### Test Patterns
- Integration tests verify external API connectivity
- Unit tests cover business logic (scoring, normalization, validation)
- Onboarding scripts run tests after completion

## Development Conventions

### Git Workflow
- **Git Flow** branching model: `master`, `develop`, `feature/*`, `release/*`
- Initialize with: `git flow init -d`
- Root `build-update.js` automates releases across all submodules

### Code Style Guidelines
- Use modern ESM imports/exports
- Prefer native Node.js APIs (e.g., native `fetch`) over external packages
- Keep dependencies lightweight for Pi compatibility
- Use `async/await` for asynchronous code
- Implement graceful shutdown handlers for long-running services

### Graceful Shutdown

All services must handle `SIGINT` and `SIGTERM`:
```typescript
const shutdown = async () => {
  // 1. Stop accepting new work
  // 2. Flush logs to logger-pi
  // 3. Close database connections
  // 4. Close server
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

## Infrastructure

### Local DNS (infra-pi)

Services are accessible via friendly `.pi` domains on the local network:
- `http://reddit.pi` → port 3000
- `http://nesthub.pi` → port 3000
- `http://memory.pi` → port 3002
- `http://medical.pi` → port 3003

**Components**:
- **dnsmasq**: DNS server resolving `.pi` domains
- **Caddy**: Reverse proxy routing by hostname
- **services.json**: Single source of truth for domain mappings

**Setup**:
```bash
cd infra-pi/dns
chmod +x install.sh apply.sh
./install.sh
```

## Service Dependencies

```
┌─────────────┐
│  logger-pi  │◄──── All services stream logs here
│   :4000     │
└─────────────┘
       ▲
       │
┌──────┴──────┬─────────────┬─────────────┬─────────────┬─────────────┐
│  reddit-pi  │ whatsapp-pi │  memory-pi  │ medical-pi  │ nesthub-pi  │
│   :3000     │   :3001     │   :3002     │   :3003     │   :3000     │
└─────────────┴─────────────┴─────────────┴─────────────┴─────────────┘
       │              │                       │
       └──────────────┘                       │
       (reddit-pi can notify via WhatsApp)   │
                                              │
       (medical-pi can notify via WhatsApp)──┘
       (medical-pi can search memory-pi)
```

## Security Considerations

- Services bind to `0.0.0.0` but are intended for local network only
- API keys configured via environment variables
- Reddit auth uses cookie-based authentication (no OAuth)
- WhatsApp auth uses QR code pairing (Baileys library)
- No external internet exposure by design

## Adding New Sub-Projects

Follow the guidelines in `SUB_PROJECT_GUIDELINES.md`:

1. Create directory and initialize Git
2. Run `git flow init -d`
3. Add as submodule: `git submodule add ./<name> <name>`
4. Implement `scripts/onboard.js` for interactive setup
5. Create `src/logger.ts` for logger-pi integration
6. Add `vitest` tests
7. Follow the standard directory structure

## Troubleshooting

### Submodule Issues
```bash
# Sync and update all submodules
git submodule sync --recursive
git submodule update --init --recursive --force
```

### Git Lock Files
The `build-update.js` script handles stale git locks automatically, waiting up to 10 seconds before force-removing.

### Logger Connection
If services fail to connect to logger-pi:
1. Ensure logger-pi is running on port 4000
2. Check that `projectId` is set correctly in the service's logger.ts
3. Services will silently drop logs if logger-pi is unavailable (by design)

## Additional Resources

- Each submodule has its own `README.md` with service-specific details
- `walkthrough.md` contains detailed notes on memory-pi implementation
- `SUB_PROJECT_GUIDELINES.md` for creating new services
