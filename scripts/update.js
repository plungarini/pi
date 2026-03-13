import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

function run(cmd, cwd = process.cwd()) {
	console.log(`> Running in ${cwd}: ${cmd}`);
	return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf-8' }).trim();
}

function runInherit(cmd, cwd = process.cwd()) {
	console.log(`> Running in ${cwd}: ${cmd}`);
	execSync(cmd, { cwd, stdio: 'inherit' });
}

function readSubmodules() {
	const gitmodulesPath = path.resolve('.gitmodules');
	if (!fs.existsSync(gitmodulesPath)) return [];

	const content = fs.readFileSync(gitmodulesPath, 'utf8');
	const regex = /path\s*=\s*(.+)/g;
	let match;
	const submodules = [];
	while ((match = regex.exec(content)) !== null) {
		if (match[1]) {
			submodules.push(match[1].trim());
		}
	}
	return submodules;
}

function askQuestion(query) {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	return new Promise((resolve) =>
		rl.question(query, (ans) => {
			rl.close();
			resolve(ans);
		}),
	);
}

const isForce = process.argv.includes('--force');

/**
 * Ensures the main repository is up to date.
 */
function updateMainRepo() {
	const localHead = run('git rev-parse HEAD');
	const originMaster = run('git rev-parse origin/master');

	if (localHead === originMaster && !isForce) {
		console.log('The main repository is already up to date with origin/master.');
		const currentBranch = run('git rev-parse --abbrev-ref HEAD');
		if (currentBranch !== 'master') {
			console.log(`Currently on ${currentBranch}. Suggest switching to master for production deployments.`);
		}
		return false; // No update performed/needed
	}

	if (isForce) {
		console.log('Force mode enabled. Hard resetting to origin/master...');
		runInherit('git reset --hard origin/master');
	} else {
		console.log('Updates are available. Pulling latest master...');
		const currentBranch = run('git rev-parse --abbrev-ref HEAD');
		if (currentBranch !== 'master') {
			runInherit('git checkout master');
		}

		try {
			runInherit('git pull origin master');
		} catch (err) {
			console.error('\nPull failed. You might have local changes that conflict.');
			console.error('Try running: npm run update-force');
			throw err;
		}
	}
	return true; // Update performed
}

/**
 * Ensures submodules are correctly synced and updated.
 */
function updateSubmodules() {
	const submodules = readSubmodules();
	console.log('\n--- Syncing Submodules ---');

	for (const sub of submodules) {
		const subPath = path.resolve(process.cwd(), sub);
		console.log(`\n> Analyzing ${sub}...`);

		// 1. Repair metadata if broken (chicken-and-egg problem)
		if (isForce && fs.existsSync(subPath)) {
			try {
				// Check if git actually recognizes this as a valid repo
				run('git rev-parse --git-dir', subPath);
			} catch (err) {
				console.warn(`[REPAIR] Submodule ${sub} metadata link is broken or corrupt. Attempting recovery...`);
				try {
					// Attempt to sync first
					runInherit(`git submodule sync -- "${sub}"`);
					// Re-check
					run('git rev-parse --git-dir', subPath);
				} catch (repairErr) {
					console.warn(`[REPAIR] Sync failed for ${sub}. Removing corrupt directory for clean re-init...`);
					// Nuclear option: remove the directory if it's broken and sync didn't fix it
					fs.rmSync(subPath, { recursive: true, force: true });
				}
			}
		}

		// 2. Fetch latest or re-init
		if (fs.existsSync(subPath)) {
			try {
				console.log(`Fetching latest for ${sub}...`);
				runInherit('git fetch origin', subPath);

				if (isForce) {
					console.log(`Force resetting ${sub} to match tracked commit...`);
					runInherit('git reset --hard', subPath);
				}
			} catch (err) {
				if (isForce) {
					console.warn(`[REPAIR] Fetch failed for ${sub}. Removing potentially corrupt directory...`);
					fs.rmSync(subPath, { recursive: true, force: true });
				} else {
					console.warn(`[NOTICE] Could not fetch/reset in ${sub}. It might be uninitialized.`);
				}
			}
		}
	}

	console.log('\nFinalizing submodule update from root...');
	try {
		// This now should have all the metadata it needs
		runInherit('git submodule update --init --recursive --force');
	} catch (err) {
		if (!isForce) {
			console.error('\nSubmodule update failed.');
			console.error('Try running: npm run update-force');
		} else {
			console.error('\nSubmodule update failed even after individual recovery attempts.');
		}
		throw err;
	}
}

async function update() {
	console.log('Fetching latest from origin...');
	runInherit('git fetch origin');

	const updated = updateMainRepo();

	// Always sync submodules to ensure they match the current HEAD
	updateSubmodules();

	if (updated || isForce) {
		console.log('Update complete!');
	}

	const submodules = readSubmodules();
	console.log('\n--- Post-Update Maintenance ---');
	console.log('To ensure a clean environment, we will now re-install dependencies for all modules.');
	await askQuestion('\n[IMPORTANT] Please close all instances of services and THEN press Enter to continue...');

	const rootDir = process.cwd();

	// Root dependencies
	if (fs.existsSync(path.join(rootDir, 'package.json'))) {
		console.log('\nUpdating root dependencies...');
		runInherit('npm install', rootDir);
	}

	// Submodule dependencies
	for (const sub of submodules) {
		const subPath = path.resolve(rootDir, sub);
		if (fs.existsSync(path.join(subPath, 'package.json'))) {
			console.log(`\nUpdating dependencies and building submodule: ${sub}...`);
			runInherit('npm install', subPath);
			runInherit('npm run build', subPath);
		}
	}

	console.log('\nAll dependencies have been updated. You can now restart your services.');
}

try {
	await update();
} catch (err) {
	console.error('Update failed:', err.message);
	process.exit(1);
}
