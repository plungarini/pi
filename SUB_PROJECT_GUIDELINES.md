# Pi Sub-Project Guidelines

This document serves as an instruction set and architectural guideline for adding or modifying any new sub-projects (microservices) within the main `pi` repository.

**Note to LLMs / AI Assistants:** If you are asked to create or refactor a sub-project in this repository, you **MUST** adhere to the following guidelines. These rules apply to all projects EXCEPT `logger-pi`, which is the base logging infrastructure.

## 1. Git Repository & Setup

Every new sub-project must act as an independent Git repository that is linked to the main `pi` repository.

- **Git Flow:** Once you create the new directory, you must initialize git flow with default settings by running `git flow init -d` inside the new project folder.
- **Submodules:** The new project folder MUST be linked to the main `pi` repository as a submodule. Use `git submodule add ./<project-name> <project-name>` from the root `pi` directory to ensure it is properly tracked in `.gitmodules`.

## 2. Automated Onboarding Scripts

Every sub-project must include an onboarding script (e.g., `scripts/onboard.js`).

- **Purpose**: To interactively guide the user through configuring their `.env` variables required to run the project.
- **Functionality**:
  - Prompt the user for missing configuration values.
  - Automatically extract tokens/cookies if possible (e.g., using Puppeteer for web scraping login sessions).
  - Handle interruption (`SIGINT` or `Ctrl+C`) gracefully by saving existing progress to the `.env` file before exiting.
  - Read existing `.env` values and use them as default prompts.
  - Start tests right after onboarding is completed.

## 3. Global Logging Integration (`logger-pi`)

Sub-projects must integrate with the centralized `logger-pi` service. Standard `console.log` output should be intercepted and archived.

- **Implementation**: Create a `src/logger.ts` file in the sub-project.
- **Behavior**:
  - Intercept native `console` methods.
  - Buffer logs locally to avoid latency impact on the running service.
  - Send batched logs asynchronously (fire-and-forget via `fetch`) to the `logger-pi` service (default: `http://127.0.0.1:4000/logs`).
  - Attach a distinct `projectId` (e.g., the folder name of the sub-project) to every payload.
- **Reference**: See `c:\DEV\pi\reddit-pi\src\logger.ts` for the standard implementation pattern.

## 4. Graceful Shutdown

Long-running services must handle termination signals (`SIGINT`, `SIGTERM`) properly.

- **Actions**:
  - Stop accepting new requests or stop the execution loops.
  - Flush any pending logs in the local logger buffer to `logger-pi` instantly.
  - Close database connections and server handles cleanly before calling `process.exit(0)`.

## 5. Testing & Quality Best Practices

- **Testing**: Include integration and unit tests using `vitest`. Tests should also be run automatically after onboarding is completed and test both functionality and any env variable validation (Auth of external APIs if present).
- **TypeScript**: Follow modern ESM standards (`"moduleResolution": "NodeNext"`, `"target": "ES2022"` or higher).
- **Environment Setup**: Keep a well-documented `.env.example` file in the project root. The actual `.env` file should be heavily gitignored.
- **Dependencies**: Keep dependencies lightweight and prefer native Node functionality (like native `fetch`) where possible to reduce bloat.

## 6. Project Organization

To maintain consistency across microservices, follow this standardized directory structure for the `src/` folder:

- **`src/core/`**: Fundamental infrastructure and shared modules (e.g., database, logger, external client wrappers).
- **`src/services/`**: Pure business logic and data processing handlers. Avoid framework-specific code (like Fastify types) here.
- **`src/api/`**: Public interface, including server setup and routes.
  - `src/api/routes/`: Route definitions and request/response handling.
- **`src/types/`**: Shared TypeScript interfaces and types.
- **`src/tests/`**: All unit and integration tests.
- **`src/index.ts`**: The main entry point of the application.
