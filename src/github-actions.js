import { Octokit } from '@octokit/rest';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from './config.js';

const octokit = new Octokit({ auth: config.githubToken });
const { owner, repo } = config;

const RUNNER_WORKFLOW = 'gitback-runner.yml';

async function getDefaultBranchSha() {
  try {
    const { data } = await octokit.git.getRef({ owner, repo, ref: 'heads/main' });
    return { sha: data.object.sha, branch: 'main' };
  } catch {
    const { data } = await octokit.git.getRef({ owner, repo, ref: 'heads/master' });
    return { sha: data.object.sha, branch: 'master' };
  }
}

async function ensureRunnerOnDefault() {
  // Make sure permanent runner exists on default branch (idempotent)
  const { data: workflows } = await octokit.actions.listRepoWorkflows({ owner, repo });
  const exists = workflows.workflows.some((w) => w.path.endsWith(RUNNER_WORKFLOW));
  if (exists) return;
  console.warn('gitback-runner.yml missing on default branch — push it to main');
}

/**
 * 1. Temp branch with source only
 * 2. Dispatch permanent runner on main (GitHub requires workflow on default branch)
 * 3. Runner checks out temp branch and builds
 */
export async function createBuild({ sourceFiles = [], workflowContent, buildName = 'build' }) {
  const buildId = uuidv4();
  const branch = `build/${buildId}`;
  const { sha: baseSha, branch: defaultBranch } = await getDefaultBranchSha();

  await ensureRunnerOnDefault();

  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha: baseSha,
  });

  // Optional: store user workflow on temp branch for reference (not dispatched)
  if (workflowContent) {
    try {
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: '.gitback/user-build.yml',
        message: `user workflow ${buildId}`,
        content: Buffer.from(workflowContent).toString('base64'),
        branch,
      });
    } catch (e) {
      console.warn('user-build.yml skip:', e.message);
    }
  }

  for (const file of sourceFiles) {
    try {
      const raw =
        file.encoding === 'base64'
          ? Buffer.from(file.content, 'base64')
          : Buffer.from(file.content || '', 'utf8');
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: file.path,
        message: `source ${file.path}`,
        content: raw.toString('base64'),
        branch,
      });
    } catch (e) {
      console.warn('file skip', file.path, e.message);
    }
  }

  // If no source files, add a marker so the branch isn't empty of commits beyond base
  if (!sourceFiles.length) {
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: '.gitback/build-id.txt',
      message: `marker ${buildId}`,
      content: Buffer.from(buildId).toString('base64'),
      branch,
    });
  }

  // Dispatch the PERMANENT workflow on the default branch
  const { data: workflows } = await octokit.actions.listRepoWorkflows({ owner, repo, per_page: 100 });
  const wf =
    workflows.workflows.find((w) => w.path.endsWith(RUNNER_WORKFLOW)) ||
    workflows.workflows.find((w) => w.name === 'GitBack Runner');

  if (!wf) {
    // cleanup temp branch
    try {
      await octokit.git.deleteRef({ owner, repo, ref: `heads/${branch}` });
    } catch {}
    throw new Error(
      'No GitBack Runner workflow on main. Ensure .github/workflows/gitback-runner.yml is on the default branch.'
    );
  }

  await octokit.actions.createWorkflowDispatch({
    owner,
    repo,
    workflow_id: wf.id,
    ref: defaultBranch,
    inputs: {
      branch,
      build_id: buildId,
    },
  });

  const dir = path.join(config.artifactsDir, buildId);
  await fs.mkdir(dir, { recursive: true });
  const meta = {
    buildId,
    name: buildName,
    branch,
    workflowId: wf.id,
    status: 'queued',
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  return { buildId, status: 'queued', message: 'Runner dispatched on main' };
}

export async function pollAndFetchArtifact(buildId) {
  const dir = path.join(config.artifactsDir, buildId);
  const metaPath = path.join(dir, 'meta.json');
  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));

  if (meta.status === 'success' || meta.status === 'failed') return meta;

  // Find workflow runs for our runner, newest first
  const { data: runs } = await octokit.actions.listWorkflowRuns({
    owner,
    repo,
    workflow_id: meta.workflowId || RUNNER_WORKFLOW,
    event: 'workflow_dispatch',
    per_page: 20,
  });

  // Match by time (created after meta) or by checking jobs/inputs is hard via API —
  // use runs created around the same time
  const created = new Date(meta.createdAt).getTime();
  const run =
    runs.workflow_runs.find((r) => {
      const t = new Date(r.created_at).getTime();
      return Math.abs(t - created) < 15 * 60 * 1000; // within 15 min
    }) || runs.workflow_runs[0];

  if (!run) {
    meta.status = 'queued';
    meta.detail = 'Waiting for workflow run…';
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    return meta;
  }

  meta.runId = run.id;
  meta.runUrl = run.html_url;

  if (run.status !== 'completed') {
    meta.status = run.status; // queued | in_progress
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    return meta;
  }

  if (run.conclusion !== 'success') {
    meta.status = 'failed';
    meta.error = run.conclusion || 'failed';
    meta.finishedAt = new Date().toISOString();
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    await deleteBranch(meta.branch);
    return meta;
  }

  const { data: arts } = await octokit.actions.listWorkflowRunArtifacts({
    owner,
    repo,
    run_id: run.id,
  });

  if (!arts.artifacts?.length) {
    meta.status = 'failed';
    meta.error = 'No artifact produced';
    meta.finishedAt = new Date().toISOString();
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    await deleteBranch(meta.branch);
    return meta;
  }

  // Prefer artifact matching build id
  const artifact =
    arts.artifacts.find((a) => a.name.includes(buildId)) || arts.artifacts[0];

  const download = await octokit.actions.downloadArtifact({
    owner,
    repo,
    artifact_id: artifact.id,
    archive_format: 'zip',
  });

  const filePath = path.join(dir, `${artifact.name}.zip`);
  await fs.writeFile(filePath, Buffer.from(await download.arrayBuffer()));

  meta.status = 'success';
  meta.artifactPath = filePath;
  meta.artifactName = artifact.name;
  meta.downloadUrl = `/api/builds/${buildId}/download`;
  meta.finishedAt = new Date().toISOString();
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
  await deleteBranch(meta.branch);
  return meta;
}

async function deleteBranch(branch) {
  if (!branch) return;
  try {
    await octokit.git.deleteRef({ owner, repo, ref: `heads/${branch}` });
  } catch (e) {
    console.warn('delete branch:', e.message);
  }
}

export async function listBuilds(limit = 20) {
  const dirs = await fs.readdir(config.artifactsDir).catch(() => []);
  const out = [];
  for (const d of dirs) {
    try {
      const meta = JSON.parse(
        await fs.readFile(path.join(config.artifactsDir, d, 'meta.json'), 'utf8')
      );
      out.push({
        buildId: meta.buildId,
        name: meta.name,
        status: meta.status,
        createdAt: meta.createdAt,
        finishedAt: meta.finishedAt || null,
        downloadUrl: meta.downloadUrl || null,
        artifactName: meta.artifactName || null,
        runUrl: meta.runUrl || null,
        error: meta.error || null,
      });
    } catch {}
  }
  return out
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

export async function getArtifactStream(buildId) {
  const meta = JSON.parse(
    await fs.readFile(path.join(config.artifactsDir, buildId, 'meta.json'), 'utf8')
  );
  if (meta.status !== 'success' || !meta.artifactPath) {
    throw new Error('Artifact not ready');
  }
  return { path: meta.artifactPath, name: `${meta.artifactName || 'artifact'}.zip` };
}
