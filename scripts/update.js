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
			console.error('Try running: npm run force-update');
			throw err;
		}
	}
	return true; // Update performed
}

/**
 * Ensures submodules are correctly synced and updated.
 */
function updateSubmodules() {
	console.log('Syncing submodules...');
	
	if (isForce) {
		console.log('Cleaning and resetting submodules recursively...');
		try {
			// Sync URLs in case they changed
			runInherit('git submodule sync --recursive');
			// Reset any local changes and clean untracked files in submodules
			runInherit('git submodule foreach --recursive "git reset --hard && git clean -fd"');
		} catch (err) {
			console.warn('Submodule cleanup completed with some warnings/errors.');
		}
	}

	try {
		runInherit('git submodule update --init --recursive --force');
	} catch (err) {
		if (!isForce) {
			console.error('\nSubmodule update failed.');
			console.error('Try running: npm run force-update');
		} else {
			console.error('\nSubmodule update failed even in force mode.');
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
