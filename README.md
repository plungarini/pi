# Pi Projects

This is the main repository that organizes several microservices and tools built for Raspberry Pi usage as Git Submodules.

## Cloning the Repository

Because this repository uses Git submodules, a standard `git clone` will leave the service folders empty.

You must clone the repository and initialize the submodules at the same time by running:

```bash
git clone --recurse-submodules git@github.com:plungarini/pi.git
```

### If you already cloned normally

If you already ran a normal `git clone` and your submodule folders are empty, you can initialize all of them after the fact by running:

```bash
git submodule update --init --recursive
```

## Automation Scripts

The root repository provides automation scripts to manage the project ecosystem:

- **`npm run build-update`**: A **developer-only** script that automates the release process. It triggers `git flow release` across all submodules, bumps versions, merges to master/develop, and pushes changes with tags.
- **`npm run update`**: The standard **production** update script. It fetches the latest code from `origin/master`, synchronizes all submodules, handles dependency installation (`npm install`), and rebuilds services to ensure a clean, up-to-date state.

## Module Documentation

Each service in this repository is independent and contains its own detailed documentation:

- [logger-pi](./logger-pi/README.md): Central logging and ingestion.
- [reddit-pi](./reddit-pi/README.md): Intelligent Reddit recommendation engine.
- [whatsapp-pi](./whatsapp-pi/README.md): WhatsApp API bridge and notification service.
- [memory-pi](./memory-pi/README.md): Semantic memory storage using vector embeddings.
- [medical-pi](./medical-pi/README.md): MedGemma-powered medical AI assistant with breathing profile.
- [nesthub-pi](./nesthub-pi/README.md): Custom Google Nest Hub display via Cast protocol.

## Running the Services

Each submodule is a fully independent microservice. General best practice is to navigate into each specific folder you wish to run, install its dependencies, and start the service:

```bash
cd <service-name>
npm install
npm run build
npm start
```

_Note: The `logger-pi` service acts as the central ingestion point for the other services. It is recommended to start the logger first so that subsequent services can seamlessly stream their logs upon boot._
