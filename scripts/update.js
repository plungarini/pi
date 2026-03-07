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

async function update() {
	console.log('Fetching latest from origin...');
	runInherit('git fetch origin');

	const localHead = run('git rev-parse HEAD');
	const originMaster = run('git rev-parse origin/master');

	if (localHead === originMaster) {
		console.log('The main repository is already up to date with origin/master.');
		// Check if we are on master, if not, switch to it?
		// Let's assume we want to be on master for the update script as it's for the end user.
		const currentBranch = run('git rev-parse --abbrev-ref HEAD');
		if (currentBranch !== 'master') {
			console.log(`Currently on ${currentBranch}. Suggest switching to master for production deployments.`);
		}

		// Attempt to sync submodules just in case
		console.log('Syncing submodules...');
		runInherit('git submodule update --init --recursive --force');
		return;
	}

	console.log('Updates are available. Pulling latest master...');

	// Ensure we are on master
	const currentBranch = run('git rev-parse --abbrev-ref HEAD');
	if (currentBranch !== 'master') {
		runInherit('git checkout master');
	}

	runInherit('git pull origin master');

	console.log('Syncing submodules to match the new master...');
	runInherit('git submodule update --init --recursive --force');

	console.log('Update complete!');

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
