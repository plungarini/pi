import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

function run(cmd, cwd = process.cwd()) {
	try {
		return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf-8' }).trim();
	} catch (e) {
		return null;
	}
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

function getSubmoduleCommit(subPath) {
	return run('git rev-parse HEAD', subPath);
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

		// Metadata repair logic (preserved from original)
		if (isForce && fs.existsSync(subPath)) {
			try {
				run('git rev-parse --git-dir', subPath);
			} catch (err) {
				console.warn(`[REPAIR] Submodule ${sub} metadata link is broken or corrupt.`);
				runInherit(`git submodule sync -- "${sub}"`);
			}
		}

		if (fs.existsSync(subPath)) {
			try {
				if (fs.existsSync(path.join(subPath, '.git'))) {
					console.log(`Fetching latest for ${sub}...`);
					runInherit('git fetch origin', subPath);
					if (isForce) {
						runInherit('git reset --hard', subPath);
					}
				}
			} catch (err) {
				console.warn(`[NOTICE] Could not fetch in ${sub}.`);
			}
		}
	}

	console.log('\nFinalizing submodule update from root...');
	runInherit('git submodule update --init --recursive --force');
}

async function update() {
	const rootDir = process.cwd();
	const subPathList = readSubmodules();
	
	// 1. Capture state BEFORE update
	const beforeState = {
		rootHash: run('git rev-parse HEAD'),
		submodules: {}
	};
	for (const sub of subPathList) {
		beforeState.submodules[sub] = getSubmoduleCommit(path.resolve(rootDir, sub));
	}

	console.log('Fetching latest from origin...');
	runInherit('git fetch origin');

	updateMainRepo();
	updateSubmodules();

	// 2. Capture state AFTER update
	const afterState = {
		rootHash: run('git rev-parse HEAD'),
		submodules: {}
	};
	for (const sub of subPathList) {
		afterState.submodules[sub] = getSubmoduleCommit(path.resolve(rootDir, sub));
	}

	// 3. Detect changes
	const rootChanged = beforeState.rootHash !== afterState.rootHash || isForce;
	const changedSubmodules = subPathList.filter(sub => 
		beforeState.submodules[sub] !== afterState.submodules[sub] || isForce
	);

	if (!rootChanged && changedSubmodules.length === 0 && !isForce) {
		console.log('\nEverything is already up to date. No manual maintenance needed.');
		return;
	}

	console.log('\n--- Smart Maintenance ---');
	const itemsToUpdate = [];
	if (rootChanged) itemsToUpdate.push('Main Repository');
	changedSubmodules.forEach(s => itemsToUpdate.push(s));
	
	console.log(`Changes detected in: ${itemsToUpdate.join(', ')}`);
	
	await askQuestion(`\n[IMPORTANT] The following services need to be updated: ${changedSubmodules.join(', ') || 'none'}.
Please close any running instances of these services AND then press Enter to continue...`);

	// Root dependencies if package.json changed or force
	if (rootChanged) {
		console.log('\nUpdating root dependencies...');
		runInherit('npm install', rootDir);
	}

	// Updated submodules
	const builtServices = [];
	for (const sub of changedSubmodules) {
		const subPath = path.resolve(rootDir, sub);
		if (fs.existsSync(path.join(subPath, 'package.json'))) {
			console.log(`\nUpdating dependencies and building: ${sub}...`);
			runInherit('npm install', subPath);
			runInherit('npm run build', subPath);
			builtServices.push(sub);
		}
	}

	// 4. Final Recap
	console.log('\n' + '='.repeat(40));
	console.log('       UPDATE SUMMARY');
	console.log('='.repeat(40));
	
	const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
	console.log(`\n✅ Pi Version: ${pkg.version}`);
	
	if (builtServices.length > 0) {
		console.log('\nUpdated Services:');
		builtServices.forEach(s => console.log(`  - ${s}`));
		console.log('\n🚀 ACTION REQUIRED: Restart the services above using "npm start" in their respective directories.');
	} else {
		console.log('\nNo submodules required rebuilding.');
	}
	
	console.log('\nFinalized successfully.');
}

try {
	await update();
} catch (err) {
	console.error('\n❌ Update failed:', err.message);
	process.exit(1);
}
