import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

async function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function getGitDir(cwd) {
	// If it's a submodule, it might have a .git file pointing to the main repo's .git/modules
	const dotGitPath = path.resolve(cwd, '.git');
	if (!fs.existsSync(dotGitPath)) return null;

	const stat = fs.statSync(dotGitPath);
	if (stat.isDirectory()) {
		return dotGitPath;
	} else {
		// It's a file (submodule), read its content: "gitdir: ../.git/modules/submodule-name"
		const content = fs.readFileSync(dotGitPath, 'utf8').trim();
		if (content.startsWith('gitdir: ')) {
			return path.resolve(cwd, content.slice(8));
		}
	}
	return null;
}

async function clearGitLock(cwd) {
	const gitDir = getGitDir(cwd);
	if (!gitDir) return;

	const lockf = path.join(gitDir, 'index.lock');
	let retries = 0;
	while (fs.existsSync(lockf) && retries < 20) {
		console.log(`\n[LOCK] Waiting for git lock to be released in ${cwd}... (${retries + 1}/20)`);
		await sleep(500);
		retries++;
	}

	if (fs.existsSync(lockf)) {
		console.warn(`\n[LOCK] Forcing removal of persistent lock file: ${lockf}`);
		try {
			fs.unlinkSync(lockf);
		} catch (e) {
			console.error(`[LOCK] Failed to remove lock file: ${e.message}`);
		}
	}
}

async function run(cmd, cwd = process.cwd(), retries = 3) {
	await clearGitLock(cwd);
	console.log(`\n> Running in ${cwd}\n$ ${cmd}`);
	try {
		return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf-8' }).trim();
	} catch (e) {
		if (retries > 0 && e.message.includes('index.lock')) {
			console.warn(`\n[RETRY] Git lock detected during execution, retrying...`);
			await sleep(1000);
			return run(cmd, cwd, retries - 1);
		}
		throw e;
	}
}

async function runInherit(cmd, cwd = process.cwd(), retries = 3) {
	await clearGitLock(cwd);
	console.log(`\n> Running in ${cwd}\n$ ${cmd}`);
	try {
		execSync(cmd, { cwd, stdio: 'inherit' });
	} catch (e) {
		if (retries > 0 && (e.message.includes('index.lock') || e.message.includes('Command failed'))) {
			// Some commands fail with non-zero exit code if lock exists
			console.warn(`\n[RETRY] Command failed or lock detected, retrying...`);
			await sleep(1000);
			return runInherit(cmd, cwd, retries - 1);
		}
		throw e;
	}
}

function getNextVersion(packageJsonPath, bumpType) {
	const content = fs.readFileSync(packageJsonPath, 'utf8');
	const pkg = JSON.parse(content);
	const versionParts = pkg.version.split('.').map(Number);
	
	if (bumpType === 'major') {
		versionParts[0] += 1;
		versionParts[1] = 0;
		versionParts[2] = 0;
	} else if (bumpType === 'minor') {
		versionParts[2] += 1;
	} else {
		// default behaviour
		versionParts[1] += 1;
		versionParts[2] = 0;
	}
	
	return versionParts.join('.');
}

function writeVersion(packageJsonPath, newVersion) {
	const content = fs.readFileSync(packageJsonPath, 'utf8');
	const pkg = JSON.parse(content);
	pkg.version = newVersion;
	fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
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

async function processSubmodule(rootDir, sub, bumpType) {
	const subPath = path.resolve(rootDir, sub);
	console.log(`\n--- Processing Submodule: ${sub} ---`);

	// Ensure we're on develop and up-to-date
	await runInherit('git checkout develop', subPath);
	await runInherit('git pull origin develop', subPath);
	await runInherit('git fetch origin master:master', subPath);

	const pkgPath = path.join(subPath, 'package.json');
	if (!fs.existsSync(pkgPath)) {
		console.warn(`No package.json found in ${subPath}, skipping.`);
		return false;
	}

	// Check if git flow is initialized
	try {
		await run('git config --get gitflow.branch.master', subPath);
	} catch (e) {
		console.log(`Initializing git flow for ${sub}...`);
		await runInherit('git flow init -d', subPath);
	}

	let hasChanges = false;
	try {
		await run('git diff master..develop --quiet', subPath);
	} catch (e) {
		hasChanges = true;
	}

	if (!hasChanges) {
		console.log(`No code changes detected in ${sub} (master and develop are identical). Skipping.`);
		return false;
	}

	const newVersion = getNextVersion(pkgPath, bumpType);
	console.log(`New version (type: ${bumpType}) will be ${newVersion} for ${sub}`);

	// Start release BEFORE changing files
	// Handle case where release branch already exists (idempotency)
	try {
		await runInherit(`git flow release start ${newVersion}`, subPath);
	} catch (e) {
		const branches = await run('git branch', subPath);
		if (branches.includes(`release/${newVersion}`)) {
			console.log(`Release branch release/${newVersion} already exists, switching to it.`);
			await runInherit(`git checkout release/${newVersion}`, subPath);
		} else {
			throw e;
		}
	}

	// Now bump and commit
	writeVersion(pkgPath, newVersion);
	await runInherit(`git add package.json`, subPath);
	try {
		await runInherit(`git commit -m "Bump version to ${newVersion}"`, subPath);
	} catch (e) {
		console.log('Version bump commit failed (maybe already committed). Continuing.');
	}

	// Finish release
	// Check if tag already exists
	const tags = await run('git tag', subPath);
	if (
		tags
			.split('\n')
			.map((t) => t.trim())
			.includes(newVersion)
	) {
		console.log(`Tag ${newVersion} already exists for ${sub}. Skipping finish.`);
	} else {
		try {
			execSync(`git flow release finish -m "Release ${newVersion}" ${newVersion}`, {
				cwd: subPath,
				env: { ...process.env, GIT_MERGE_AUTOEDIT: 'no', GIT_EDITOR: 'true' },
				stdio: 'inherit',
			});
		} catch (e) {
			console.error(`Failed to finish release ${newVersion} for ${sub}.`);
			process.exit(1);
		}
	}

	// Push
	await runInherit('git push origin develop', subPath);
	await runInherit('git push origin master', subPath);
	await runInherit('git push --tags', subPath);
	return true;
}

async function buildUpdate() {
	const rootDir = process.cwd();
	const submodules = readSubmodules();

	console.log(`Found ${submodules.length} submodules: ${submodules.join(', ')}`);

	let atLeastOneSubmoduleBumped = false;

	const args = process.argv.slice(2);
	let bumpType = 'default';

	if (args.includes('--major') || args.includes('major')) bumpType = 'major';
	else if (args.includes('--minor') || args.includes('minor')) bumpType = 'minor';

	const flags = args.filter((arg) => arg.startsWith('--'));
	if (flags.length > 1) {
		console.error('Error: Only one version bump flag is accepted.');
		process.exit(1);
	}

	// Update submodules first
	for (const sub of submodules) {
		if (await processSubmodule(rootDir, sub, bumpType)) {
			atLeastOneSubmoduleBumped = true;
		}
	}

	// Settle down for a moment to let OS release file handles or locks
	console.log('\nSubmodules processed. Settling for 2 seconds...');
	await sleep(2000);

	// Update main repository
	console.log(`\n--- Processing Main Repository ---`);
	await runInherit('git checkout develop', rootDir);
	await runInherit('git pull origin develop', rootDir);

	try {
		await run('git config --get gitflow.branch.master', rootDir);
	} catch (e) {
		console.log(`Initializing git flow for main repository...`);
		await runInherit('git flow init -d', rootDir);
	}

	// Commit any updates (submodule pointers, .gitignore, etc) to develop BEFORE starting the release
	await runInherit('git add .', rootDir);
	try {
		await runInherit('git commit -m "chore: sync submodules and updates before release"', rootDir);
	} catch (e) {
		console.log('No changes to commit in main repository before release.');
	}

	const rootPkgPath = path.join(rootDir, 'package.json');

	// Root release happens even if no changes were detected (as per user request)
	let hasCodeChanges = false;
	try {
		await run('git diff master..develop --quiet', rootDir);
	} catch (e) {
		hasCodeChanges = true;
	}

	if (!hasCodeChanges && !atLeastOneSubmoduleBumped) {
		console.log('\nNote: No new changes or bumped submodules detected, but proceeding with root release as requested.');
	}

	const newRootVersion = getNextVersion(rootPkgPath, bumpType);
	console.log(`New root version (type: ${bumpType}) will be ${newRootVersion}`);

	// Handle case where release branch already exists (idempotency)
	try {
		await runInherit(`git flow release start ${newRootVersion}`, rootDir);
	} catch (e) {
		const branches = await run('git branch', rootDir);
		if (branches.includes(`release/${newRootVersion}`)) {
			console.log(`Release branch release/${newRootVersion} already exists, switching to it.`);
			await runInherit(`git checkout release/${newRootVersion}`, rootDir);
		} else {
			throw e;
		}
	}

	writeVersion(rootPkgPath, newRootVersion);
	await runInherit('git add package.json', rootDir);
	try {
		await runInherit(`git commit -m "Bump version to ${newRootVersion}"`, rootDir);
	} catch (e) {
		console.log('Version bump commit failed (maybe already committed). Continuing.');
	}

	// Finish root release
	const rootTags = await run('git tag', rootDir);
	if (
		rootTags
			.split('\n')
			.map((t) => t.trim())
			.includes(newRootVersion)
	) {
		console.log(`Tag ${newRootVersion} already exists for main repo. Skipping finish.`);
	} else {
		try {
			execSync(`git flow release finish -m "Release ${newRootVersion}" ${newRootVersion}`, {
				cwd: rootDir,
				env: { ...process.env, GIT_MERGE_AUTOEDIT: 'no', GIT_EDITOR: 'true' },
				stdio: 'inherit',
			});
		} catch (e) {
			console.error(`Failed to finish root release ${newRootVersion}.`);
			process.exit(1);
		}
	}

	await runInherit('git push origin develop', rootDir);
	await runInherit('git push origin master', rootDir);
	await runInherit('git push --tags', rootDir);

	console.log(`\nAll done! Released version ${newRootVersion} across all modules.`);
}

try {
	await buildUpdate();
} catch (err) {
	console.error('Build-update failed:', err.message);
	process.exit(1);
}
