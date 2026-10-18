import { Octokit } from '@octokit/rest';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from './config.js';

const octokit = new Octokit({ auth: config.githubToken });
const { owner, repo } = config;

async function getDefaultBranchSha() {
  try {
    const { data } = await octokit.git.getRef({ owner, repo, ref: 'heads/main' });
    return data.object.sha;
  } catch {
    const { data } = await octokit.git.getRef({ owner, repo, ref: 'heads/master' });
    return data.object.sha;
  }
}

/**
 * Create build: temp branch → upload workflow + files → trigger → return buildId
 */
export async function createBuild({ sourceFiles = [], workflowContent, buildName = 'build' }) {
  const buildId = uuidv4();
  const branch = `build/${buildId}`;
  const baseSha = await getDefaultBranchSha();

  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha: baseSha,
  });

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: '.github/workflows/build.yml',
    message: `build ${buildId}`,
    content: Buffer.from(workflowContent).toString('base64'),
    branch,
  });

  for (const file of sourceFiles) {
    const raw = file.encoding === 'base64'
      ? Buffer.from(file.content, 'base64')
      : Buffer.from(file.content, 'utf8');
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: file.path,
      message: `source ${file.path}`,
      content: raw.toString('base64'),
      branch,
    });
  }

  // workflow must be on the branch; dispatch on that ref
  // Find workflow by waiting briefly then listing, or dispatch by filename after push
  await new Promise((r) => setTimeout(r, 2000));

  let workflowId = null;
  const { data: workflows } = await octokit.actions.listRepoWorkflows({ owner, repo });
  const wf = workflows.workflows.find((w) => w.path.includes('build.yml'));
  if (wf) workflowId = wf.id;

  if (workflowId) {
    await octokit.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: workflowId,
      ref: branch,
    });
  } else {
    // Fallback: push alone may trigger if on: push — prefer workflow_dispatch in yml
    console.warn('No build.yml workflow found yet; run may need manual dispatch');
  }

  const dir = path.join(config.artifactsDir, buildId);
  await fs.mkdir(dir, { recursive: true });
  const meta = {
    buildId,
    name: buildName,
    branch,
    status: 'queued',
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  return { buildId, status: 'queued' };
}

/**
 * Poll run status; on success download first artifact, delete temp branch
 */
export async function pollAndFetchArtifact(buildId) {
  const dir = path.join(config.artifactsDir, buildId);
  const metaPath = path.join(dir, 'meta.json');
  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));

  if (meta.status === 'success' || meta.status === 'failed') return meta;

  const { data: runs } = await octokit.actions.listWorkflowRunsForRepo({
    owner,
    repo,
    branch: meta.branch,
    per_page: 5,
  });

  const run = runs.workflow_runs[0];
  if (!run) {
    meta.status = 'queued';
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    return meta;
  }

  if (run.status !== 'completed') {
    meta.status = run.status; // in_progress, etc
    meta.runId = run.id;
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    return meta;
  }

  if (run.conclusion !== 'success') {
    meta.status = 'failed';
    meta.error = run.conclusion;
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
    meta.error = 'No artifact';
    meta.finishedAt = new Date().toISOString();
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    await deleteBranch(meta.branch);
    return meta;
  }

  const artifact = arts.artifacts[0];
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
