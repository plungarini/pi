# Pi Sub-Project Guidelines

This document serves as an instruction set and architectural guideline for adding or modifying any new sub-projects (microservices) within the main `pi` repository.

**Note to LLMs / AI Assistants:** If you are asked to create or refactor a sub-project in this repository, you **MUST** adhere to the following guidelines. These rules apply to all projects EXCEPT `logger-pi`, which is the base logging infrastructure.

---

## 1. Git Repository & Setup

Every new sub-project must act as an independent Git repository that is linked to the main `pi` repository.

### 1.1 Directory Creation

- Create a new directory with the service name (e.g., `medical-pi`) in the root of the `pi` repository (if not present)
- The directory name should be lowercase with hyphens (kebab-case)
- Must match the pattern: `<service-name>-pi` for consistency

### 1.2 Git Flow Initialization

```bash
cd <project-name>
git init

# Initialize git flow with default settings
git flow init -d

# Verify branches were created
git branch -a
# Should show:
# * develop
#   master
```

**Note:** `git flow init -d` automatically:

- Creates `master` branch (production releases)
- Creates `develop` branch (integration branch)
- Sets up feature/, release/, hotfix/, support/ prefixes
- Switches to `develop` branch

### 1.3 Create GitHub Repository

Using GitHub CLI (gh):

```bash
cd <project-name>

# Create public repo and push branches
gh repo create <username>/<project-name> --public --source=. --remote=origin --push

# Verify remote
git remote -v
# Should show:
# origin  git@github.com:<username>/<project-name>.git (fetch)
# origin  git@github.com:<username>/<project-name>.git (push)
```

Or create manually on GitHub, then:

```bash
git remote add origin git@github.com:<username>/<project-name>.git
git push -u origin master
git push -u origin develop
```

### 1.4 Submodule Registration

From the **root** `pi` directory:

```bash
cd /path/to/pi

# Add submodule with SSH URL (not local path)
git submodule add git@github.com:<username>/<project-name>.git <project-name>

# Verify .gitmodules has SSH URL
cat .gitmodules
# Should show:
# [submodule "<project-name>"]
#     path = <project-name>
#     url = git@github.com:<username>/<project-name>.git
```

**Important:** Always use SSH URLs (`git@github.com:...`) not local paths (`./<project-name>`) for submodules.

---

## 2. Automated Onboarding Scripts

Every sub-project **MUST** include an onboarding script at `scripts/onboard.js`.

### 2.1 Purpose

Interactively guide the user through configuring required `.env` variables to run the project.

### 2.2 Required Functionality

| Feature              | Description                                                    |
| -------------------- | -------------------------------------------------------------- |
| Read existing `.env` | Load current values as defaults for prompts                    |
| Prompt for secrets   | Request API keys, tokens, passwords securely                   |
| Auto-extraction      | Use Puppeteer for web scraping/cookie extraction if applicable |
| SIGINT handler       | Save progress to `.env` on Ctrl+C before exiting               |
| Run tests            | Execute `vitest` automatically after completion                |
| Verify connections   | Test external APIs (Modal, OpenRouter, etc.) with ping calls   |

### 2.3 Onboarding Flow

1. Read existing `.env` (if present) or copy from `.env.example`
2. Display welcome banner with project name
3. Prompt for required environment variables
4. Verify external service connectivity
5. Create storage directories if needed
6. Run database migrations
7. Initialize external services (e.g., Meilisearch indexes)
8. Save `.env` file
9. Run tests

---

## 3. Global Logging Integration (`logger-pi`)

Sub-projects **MUST** integrate with the centralized `logger-pi` service running on port 4000.

### 3.1 Implementation

Create `src/logger.ts` with the following behavior:

```typescript
// Required features:
- Intercept console.log/warn/error/debug/info
- Buffer logs locally (500ms flush interval)
- POST asynchronously to http://127.0.0.1:4000/logs
- Attach projectId matching the folder name
- Handle SIGTERM/SIGINT to flush before exit
- Memory leak protection (limit queue to 5000 entries)
```

### 3.2 Reference Implementation

See `reddit-pi/src/logger.ts` for the standard pattern.

### 3.3 Environment Variables

```env
LOGGER_PI_URL=http://127.0.0.1:4000
LOGGER_PI_SERVICE_NAME=<project-name>
```

---

## 4. Graceful Shutdown

Long-running services **MUST** handle `SIGINT` and `SIGTERM` signals.

### 4.1 Shutdown Sequence

1. Stop accepting new requests/connections
2. Flush pending logs to `logger-pi`
3. Close database connections
4. Stop background jobs (cron, intervals)
5. Close HTTP server
6. Call `process.exit(0)`

### 4.2 Implementation Template

```typescript
const shutdown = async (signal: string) => {
	console.log(`Received ${signal}, shutting down gracefully...`);
	await globalLogger.close();
	await server.close();
	process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
```

---

## 5. Raspberry Pi & Linux Compatibility

All microservices in the Pi ecosystem run on Raspberry Pi (ARM64/Linux). To ensure smooth deployment and operation:

### 5.1 Runtime Requirements

| Requirement            | Description                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| **Node.js Only**       | Use TypeScript/JavaScript exclusively. Avoid Python, Go, Rust, or other runtimes               |
| **No Docker**          | Services must run directly on the host system                                                  |
| **No External Config** | No manual OS-level configuration, systemd units (except Meilisearch), or external dependencies |
| **Self-Contained**     | Everything needed must be installed via `npm install` or the onboarding script                 |

### 5.2 One-Step Setup Principle

A new user should only need these commands:

```bash
cd <project-name>
npm install          # Install dependencies
npm run onboard      # Interactive configuration (creates .env, sets up DB, etc.)
npm start            # Start the service
```

**No additional steps allowed.** If something requires installation (like Meilisearch), the onboarding script must:

- Detect if it's missing
- Download/install it automatically
- Configure it without user intervention

### 5.3 Avoiding Python

- **Preferred**: Use Node.js libraries for everything (SQLite, HTTP, file operations, etc.)
- **If Python Required**: The onboarding script must:
  - Detect Python installation
  - Create a virtual environment automatically
  - Install Python dependencies via requirements.txt
  - Configure paths without user intervention
- **Example**: If using Python for ML inference, the onboarding script should handle `python -m venv venv && pip install -r requirements.txt`

### 5.4 File System Considerations

- Use relative paths or configurable `BASE_STORAGE_PATH`
- Default data directory: `/data/<project-name>` (configurable via `.env`)
- Create directories automatically on startup if they don't exist
- Handle permission errors gracefully

### 5.5 ARM64 Compatibility

- Prefer pure-JavaScript npm packages over native bindings
- If native bindings required (like `better-sqlite3`), ensure they provide ARM64 binaries
- Test on Raspberry Pi or use `npm install` in CI to verify ARM64 builds

---

## 6. Testing & Quality Best Practices

### 6.1 Testing Requirements

- **Framework**: Vitest
- **Location**: `src/tests/` directory
- **Coverage**:
  - Unit tests for business logic (services)
  - Integration tests for external API connectivity
  - Route tests for API endpoints
- **Automation**: Tests run automatically after onboarding completes

### 6.2 TypeScript Configuration

```json
{
	"compilerOptions": {
		"target": "ES2022",
		"module": "NodeNext",
		"moduleResolution": "NodeNext",
		"strict": true,
		"esModuleInterop": true
	}
}
```

### 6.3 Dependencies

- Prefer native Node.js APIs (native `fetch`, `fs`, etc.)
- Keep dependencies lightweight for Pi compatibility
- Pin major versions to avoid breaking changes

### 6.4 Environment Files

- `.env.example`: Template with ALL required variables (committed)
- `.env`: Actual configuration (gitignored, never committed)
- Both files must include comments explaining each variable

### 6.5 Naming Conventions

- Files: kebab-case (e.g., `chat-service.ts`)
- Classes: PascalCase (e.g., `ChatService`)
- Functions/variables: camelCase (e.g., `getSession`)
- Constants: UPPER_SNAKE_CASE for env vars, camelCase otherwise

---

## 7. Main Repository Updates

After creating a new sub-project, you **MUST** update the following files in the **main** `pi` repository:

### 7.1 AGENTS.md

Add the new service to:

- **Project Overview** section (bullet list)
- **Repository Structure** diagram/code block
- **Service-Specific Technologies** section
- **Service Startup Order** list
- **Service Dependencies** diagram
- **Local DNS** section (if exposed)

### 7.2 README.md (Module Documentation)

Add a link to the new service in the "Module Documentation" section:

```markdown
## Module Documentation

Each service in this repository is independent and contains its own detailed documentation:

- [logger-pi](./logger-pi/README.md): Central logging and ingestion.
- [reddit-pi](./reddit-pi/README.md): Intelligent Reddit recommendation engine.
- [<project-name>](./<project-name>/README.md): <One-line description of what it does>.
```

### 7.3 infra-pi/dns/services.json (If Exposed)

If the microservice needs to be accessible via a friendly `.pi` domain, add an entry to the DNS configuration:

```json
{
  "pi_ip": "100.117.10.9",
  "services": [
    {
      "domain": "reddit.pi",
      "note": "Reddit recommendation engine",
      "port": 3000
    },
    {
      "domain": "<service>.pi",
      "note": "<Description of the service>",
      "port": <port_number>
    }
  ]
}
```

**When to add to DNS:**

- Service has a web UI
- Service needs to be accessed by users via browser
- Service follows the port convention (3000+ for HTTP services)

**When NOT to add to DNS:**

- Service is internal-only (no UI)
- Service is accessed only by other services via localhost
- Service uses non-HTTP protocols exclusively

---

## 9. Checklist for New Sub-Projects

Before considering a new sub-project complete, verify:

### Git & Repository Setup (§1, §10)

- [ ] Git repository initialized with `git flow init -d`
- [ ] `master` and `develop` branches pushed to GitHub
- [ ] Added as submodule to main pi repo using SSH URL (`git@github.com:...`)

### Core Implementation (§2, §3, §4)

- [ ] `scripts/onboard.js` implemented and tested - **only `npm install`, `npm run onboard`, `npm start` needed**
- [ ] `src/logger.ts` implemented for logger-pi integration
- [ ] Graceful shutdown handlers for SIGINT/SIGTERM
- [ ] Onboarding handles all setup automatically (no manual steps)

### Pi/Linux Compatibility (§5)

- [ ] **No Python** - pure Node.js implementation preferred
- [ ] **No Docker** - runs directly on Raspberry Pi
- [ ] **No external dependencies** - everything via npm or automated onboarding
- [ ] ARM64 compatible packages only
- [ ] Storage paths configurable via `BASE_STORAGE_PATH` env var
- [ ] Directories created automatically on startup

### Quality & Testing (§6)

- [ ] Vitest tests in `src/tests/`
- [ ] Tests run automatically after onboarding
- [ ] TypeScript configured with ES2022/NodeNext

### Documentation & Configuration (§7, §8)

- [ ] `.env.example` with ALL required variables documented
- [ ] `package.json` with proper scripts (build, dev, start, test, onboard)
- [ ] README.md with setup and usage instructions
- [ ] AGENTS.md updated with service details
- [ ] README.md (main repo) updated with Module Documentation link
- [ ] infra-pi/dns/services.json updated (if service exposed via DNS)
