import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function run(cmd, cwd = process.cwd()) {
	console.log(`\n> Running in ${cwd}\n$ ${cmd}`);
	return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf-8' }).trim();
}

function runInherit(cmd, cwd = process.cwd()) {
	console.log(`\n> Running in ${cwd}\n$ ${cmd}`);
	execSync(cmd, { cwd, stdio: 'inherit' });
}

function getNextMinorVersion(packageJsonPath) {
	const content = fs.readFileSync(packageJsonPath, 'utf8');
	const pkg = JSON.parse(content);
	const versionParts = pkg.version.split('.').map(Number);
	versionParts[1] += 1;
	versionParts[2] = 0;
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

async function buildUpdate() {
	const rootDir = process.cwd();
	const submodules = readSubmodules();

	console.log(`Found ${submodules.length} submodules: ${submodules.join(', ')}`);

	let atLeastOneSubmoduleBumped = false;

	// Update submodules first
	for (const sub of submodules) {
		const subPath = path.resolve(rootDir, sub);
		console.log(`\n--- Processing Submodule: ${sub} ---`);

		// Ensure we're on develop and up-to-date
		runInherit('git checkout develop', subPath);
		runInherit('git pull origin develop', subPath);

		const pkgPath = path.join(subPath, 'package.json');
		if (!fs.existsSync(pkgPath)) {
			console.warn(`No package.json found in ${subPath}, skipping.`);
			continue;
		}

		// Check if git flow is initialized
		try {
			run('git config --get gitflow.branch.master', subPath);
		} catch (e) {
			console.log(`Initializing git flow for ${sub}...`);
			runInherit('git flow init -d', subPath);
		}

		const changeCount = Number.parseInt(run('git rev-list master..develop --count', subPath), 10);
		if (changeCount === 0) {
			console.log(`No changes detected in ${sub} (develop is not ahead of master). Skipping.`);
			continue;
		}

		const newVersion = getNextMinorVersion(pkgPath);
		console.log(`New version will be ${newVersion} for ${sub}`);

		// Start release BEFORE changing files
		runInherit(`git flow release start ${newVersion}`, subPath);

		// Now bump and commit
		writeVersion(pkgPath, newVersion);
		runInherit(`git add package.json`, subPath);
		runInherit(`git commit -m "Bump version to ${newVersion}"`, subPath);

		// Finish release
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

		// Push
		runInherit('git push origin develop', subPath);
		runInherit('git push origin master', subPath);
		runInherit('git push --tags', subPath);
		atLeastOneSubmoduleBumped = true;
	}

	// Update main repository
	console.log(`\n--- Processing Main Repository ---`);
	runInherit('git checkout develop', rootDir);
	runInherit('git pull origin develop', rootDir);

	try {
		run('git config --get gitflow.branch.master', rootDir);
	} catch (e) {
		console.log(`Initializing git flow for main repository...`);
		runInherit('git flow init -d', rootDir);
	}

	// Commit any updates (submodule pointers, .gitignore, etc) to develop BEFORE starting the release
	runInherit('git add .', rootDir);
	try {
		runInherit('git commit -m "chore: sync submodules and updates before release"', rootDir);
	} catch (e) {
		console.log('No changes to commit in main repository before release.');
	}

	const rootPkgPath = path.join(rootDir, 'package.json');
	// Root release happens even if no changes were detected (as per user request)
	const hasCodeChanges = run('git rev-list master..develop --count', rootDir) !== '0';
	if (!hasCodeChanges && !atLeastOneSubmoduleBumped) {
		console.log('\nNote: No new changes or bumped submodules detected, but proceeding with root release as requested.');
	}

	const newRootVersion = getNextMinorVersion(rootPkgPath);
	console.log(`New root version will be ${newRootVersion}`);

	runInherit(`git flow release start ${newRootVersion}`, rootDir);

	writeVersion(rootPkgPath, newRootVersion);
	runInherit('git add package.json', rootDir);
	runInherit(`git commit -m "Bump version to ${newRootVersion}"`, rootDir);

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

	runInherit('git push origin develop', rootDir);
	runInherit('git push origin master', rootDir);
	runInherit('git push --tags', rootDir);

	console.log(`\nAll done! Released version ${newRootVersion} across all modules.`);
}

try {
	await buildUpdate();
} catch (err) {
	console.error('Build-update failed:', err.message);
	process.exit(1);
}
