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

function compareVersions(v1, v2) {
	const a = v1.split('.').map(Number);
	const b = v2.split('.').map(Number);
	for (let i = 0; i < 3; i++) {
		if (a[i] > b[i]) return 1;
		if (b[i] > a[i]) return -1;
	}
	return 0;
}

async function getNextVersion(cwd, packageJsonRelativeToCwd, bumpType) {
	const fullPath = path.join(cwd, packageJsonRelativeToCwd);
	const content = fs.readFileSync(fullPath, 'utf8');
	const pkg = JSON.parse(content);
	const localVersion = pkg.version;
	let baseVersion = localVersion;

	// Try to get version from master to compare
	try {
		const masterPkgContent = execSync(`git show master:${packageJsonRelativeToCwd}`, { 
			cwd, 
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'ignore'] 
		});
		const masterPkg = JSON.parse(masterPkgContent);
		if (compareVersions(masterPkg.version, baseVersion) > 0) {
			console.log(`[VERSION] Master version (${masterPkg.version}) is higher than local (${localVersion}).`);
			baseVersion = masterPkg.version;
		}
	} catch (e) {
		// master or package.json on master might not exist
	}

	const versionParts = baseVersion.split('.').map(Number);
	
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
	
	const nextVersion = versionParts.join('.');
	const indent = detectIndentation(content);
	return { nextVersion, baseVersion, localVersion, indent };
}

function detectIndentation(content) {
	const lines = content.split('\n');
	for (const line of lines) {
		const match = line.match(/^(\s+)"/);
		if (match) {
			return match[1];
		}
	}
	return 2; // Default to 2 spaces
}

async function ensureNoOtherReleaseBranch(cwd, targetVersion) {
	const branchesOutput = await run('git branch', cwd);
	const branches = branchesOutput.split('\n').map(b => b.replace('*', '').trim());
	const releaseBranches = branches.filter(b => b.startsWith('release/'));
	
	for (const branch of releaseBranches) {
		const version = branch.replace('release/', '');
		if (version !== targetVersion) {
			console.log(`[FLOW] Found stale release branch: ${branch} in ${cwd}. Removing it...`);
			
			// If we are on the branch, switch to develop first
			const currentBranch = branchesOutput.includes('*') ? branchesOutput.split('\n').find(l => l.startsWith('*')).replace('*', '').trim() : '';
			if (currentBranch === branch) {
				await runInherit('git checkout develop', cwd);
			}
			
			await runInherit(`git branch -D ${branch}`, cwd);
		}
	}
}

function writeVersion(packageJsonPath, newVersion, indent = 2) {
	const content = fs.readFileSync(packageJsonPath, 'utf8');
	const pkg = JSON.parse(content);
	pkg.version = newVersion;
	fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, indent) + '\n');
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

	const { nextVersion, baseVersion, localVersion, indent } = await getNextVersion(subPath, 'package.json', bumpType);

	if (compareVersions(baseVersion, localVersion) > 0) {
		console.log(`[SYNC] Submodule ${sub} local version (${localVersion}) is behind master (${baseVersion}). Syncing develop...`);
		writeVersion(pkgPath, baseVersion, indent);
		await runInherit(`git add package.json`, subPath);
		await runInherit(`git commit -m "chore: sync package.json version and formatting with master (${baseVersion})"`, subPath);
	} else {
		// Even if versions match, check for formatting differences
		try {
			await run(`git diff master..develop --quiet -- package.json`, subPath);
		} catch (e) {
			console.log(`[SYNC] Submodule ${sub} package.json formatting mismatch with master. Syncing formatting...`);
			writeVersion(pkgPath, localVersion, indent); // Re-write with detected indent
			await runInherit(`git add package.json`, subPath);
			await runInherit(`git commit -m "chore: sync package.json formatting with master"`, subPath);
		}
	}

	console.log(`New version (type: ${bumpType}) will be ${nextVersion} for ${sub}`);

	// Ensure no other release branches exist
	await ensureNoOtherReleaseBranch(subPath, nextVersion);

	// Start release BEFORE changing files
	// Handle case where release branch already exists (idempotency)
	try {
		await runInherit(`git flow release start ${nextVersion}`, subPath);
	} catch (e) {
		const branches = await run('git branch', subPath);
		if (branches.includes(`release/${nextVersion}`)) {
			console.log(`Release branch release/${nextVersion} already exists, switching to it.`);
			await runInherit(`git checkout release/${nextVersion}`, subPath);
		} else {
			throw e;
		}
	}

	// Now bump and commit
	writeVersion(pkgPath, nextVersion, indent);
	await runInherit(`git add package.json`, subPath);
	try {
		await runInherit(`git commit -m "Bump version to ${nextVersion}"`, subPath);
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
			.includes(nextVersion)
	) {
		console.log(`Tag ${nextVersion} already exists for ${sub}. Skipping finish.`);
	} else {
		try {
			execSync(`git flow release finish -m "Release ${nextVersion}" ${nextVersion}`, {
				cwd: subPath,
				env: { ...process.env, GIT_MERGE_AUTOEDIT: 'no', GIT_EDITOR: 'true' },
				stdio: 'inherit',
			});
		} catch (e) {
			console.error(`Failed to finish release ${nextVersion} for ${sub}. Attempting auto-resolution...`);
			try {
				// Resolve conflict by favoring release branch version
				await runInherit('git checkout --ours package.json', subPath);
				await runInherit('git add package.json', subPath);
				await runInherit('git commit --no-edit', subPath);
				console.log(`[RESOLVED] Conflict in ${sub} resolved automatically.`);
			} catch (resolveErr) {
				console.error(`[FATAL] Could not auto-resolve conflict for ${sub}. Manual intervention required.`);
				process.exit(1);
			}
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
	await runInherit('git fetch origin master:master', rootDir);

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

	const { nextVersion: rootNextVersion, baseVersion: rootBaseVersion, localVersion: rootLocalVersion, indent: rootIndent } = await getNextVersion(rootDir, 'package.json', bumpType);

	if (compareVersions(rootBaseVersion, rootLocalVersion) > 0) {
		console.log(`[SYNC] Main repository local version (${rootLocalVersion}) is behind master (${rootBaseVersion}). Syncing develop...`);
		writeVersion(rootPkgPath, rootBaseVersion, rootIndent);
		await runInherit(`git add package.json`, rootDir);
		await runInherit(`git commit -m "chore: sync package.json version and formatting with master (${rootBaseVersion})"`, rootDir);
	} else {
		// Even if versions match, check for formatting differences
		try {
			await run(`git diff master..develop --quiet -- package.json`, rootDir);
		} catch (e) {
			console.log(`[SYNC] Main repository package.json formatting mismatch with master. Syncing formatting...`);
			writeVersion(rootPkgPath, rootLocalVersion, rootIndent);
			await runInherit(`git add package.json`, rootDir);
			await runInherit(`git commit -m "chore: sync package.json formatting with master"`, rootDir);
		}
	}

	console.log(`New root version (type: ${bumpType}) will be ${rootNextVersion}`);

	// Ensure no other release branches exist
	await ensureNoOtherReleaseBranch(rootDir, rootNextVersion);

	// Handle case where release branch already exists (idempotency)
	try {
		await runInherit(`git flow release start ${rootNextVersion}`, rootDir);
	} catch (e) {
		const branches = await run('git branch', rootDir);
		if (branches.includes(`release/${rootNextVersion}`)) {
			console.log(`Release branch release/${rootNextVersion} already exists, switching to it.`);
			await runInherit(`git checkout release/${rootNextVersion}`, rootDir);
		} else {
			throw e;
		}
	}

	writeVersion(rootPkgPath, rootNextVersion, rootIndent);
	await runInherit('git add package.json', rootDir);
	try {
		await runInherit(`git commit -m "Bump version to ${rootNextVersion}"`, rootDir);
	} catch (e) {
		console.log('Version bump commit failed (maybe already committed). Continuing.');
	}

	// Finish root release
	const rootTags = await run('git tag', rootDir);
	if (
		rootTags
			.split('\n')
			.map((t) => t.trim())
			.includes(rootNextVersion)
	) {
		console.log(`Tag ${rootNextVersion} already exists for main repo. Skipping finish.`);
	} else {
		try {
			execSync(`git flow release finish -m "Release ${rootNextVersion}" ${rootNextVersion}`, {
				cwd: rootDir,
				env: { ...process.env, GIT_MERGE_AUTOEDIT: 'no', GIT_EDITOR: 'true' },
				stdio: 'inherit',
			});
		} catch (e) {
			console.error(`Failed to finish root release ${rootNextVersion}. Attempting auto-resolution...`);
			try {
				await runInherit('git checkout --ours package.json', rootDir);
				await runInherit('git add package.json', rootDir);
				await runInherit('git commit --no-edit', rootDir);
				console.log(`[RESOLVED] Root conflict resolved automatically.`);
			} catch (resolveErr) {
				console.error(`[FATAL] Could not auto-resolve root conflict. Manual intervention required.`);
				process.exit(1);
			}
		}
	}

	await runInherit('git push origin develop', rootDir);
	await runInherit('git push origin master', rootDir);
	await runInherit('git push --tags', rootDir);

	console.log(`\nAll done! Released version ${rootNextVersion} across all modules.`);
}

try {
	await buildUpdate();
} catch (err) {
	console.error('Build-update failed:', err.message);
	process.exit(1);
}
