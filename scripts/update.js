import { execSync } from 'child_process';

function run(cmd, cwd = process.cwd()) {
	console.log(`> Running in ${cwd}: ${cmd}`);
	return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf-8' }).trim();
}

function runInherit(cmd, cwd = process.cwd()) {
	console.log(`> Running in ${cwd}: ${cmd}`);
	execSync(cmd, { cwd, stdio: 'inherit' });
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
		runInherit('git submodule update --init --recursive');
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
	runInherit('git submodule update --init --recursive');

	console.log('Update complete!');
	console.log(
		'Note: You may need to restart the services and run `npm install` inside the submodules if dependencies changed.',
	);
}

update().catch((err) => {
	console.error('Update failed:', err.message);
	process.exit(1);
});
