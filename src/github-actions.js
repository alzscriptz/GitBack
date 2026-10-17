/**
 * Secure GitHub Actions bridge.
 * - Source is pushed ONLY into a private GitHub repo (never returned to frontend).
 * - Workflow runs on GitHub's runners.
 * - Only the final artifact is downloaded and stored locally for the site.
 * - Frontend never sees source, never sees workflow logs, never sees the Action run.
 */

import { Octokit } from '@octokit/rest';
import fs from 'fs/promises';
import path from 'path';
import { config } from './config.js';
import { v4 as uuidv4 } from 'uuid';

const octokit = new Octokit({ auth: config.githubToken });

/**
 * Create a new build:
 * 1. (Optional) receive source as zip or files from the frontend
 * 2. Push source + a build.yml into the private GitHub repo
 * 3. Trigger the workflow_dispatch
 * 4. Return a buildId that the frontend can poll
 */
export async function createBuild({ sourceFiles = [], workflowContent, buildName = 'build' }) {
  if (!config.githubToken || !config.githubOwner || !config.githubRepo) {
    throw new Error('GitHub credentials not configured. Set GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO in .env');
  }

  const buildId = uuidv4();
  const branch = `build/${buildId}`;

  // 1. Create a new branch from main/master
  const { data: refData } = await octokit.git.getRef({
    owner: config.githubOwner,
    repo: config.githubRepo,
    ref: 'heads/main',
  }).catch(async () => {
    // fallback to master
    return octokit.git.getRef({
      owner: config.githubOwner,
      repo: config.githubRepo,
      ref: 'heads/master',
    });
  });

  const baseSha = refData.object.sha;

  await octokit.git.createRef({
    owner: config.githubOwner,
    repo: config.githubRepo,
    ref: `refs/heads/${branch}`,
    sha: baseSha,
  });

  // 2. Upload the workflow file
  const workflowPath = '.github/workflows/build.yml';
  const workflowB64 = Buffer.from(workflowContent).toString('base64');

  await octokit.repos.createOrUpdateFileContents({
    owner: config.githubOwner,
    repo: config.githubRepo,
    path: workflowPath,
    message: `chore: add build workflow for ${buildId}`,
    content: workflowB64,
    branch,
  });

  // 3. Upload source files (if any were sent)
  for (const file of sourceFiles) {
    const contentB64 = Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8').toString('base64');
    await octokit.repos.createOrUpdateFileContents({
      owner: config.githubOwner,
      repo: config.githubRepo,
      path: file.path,
      message: `feat: add source ${file.path} for build ${buildId}`,
      content: contentB64,
      branch,
    });
  }

  // 4. Trigger workflow_dispatch
  await octokit.actions.createWorkflowDispatch({
    owner: config.githubOwner,
    repo: config.githubRepo,
    workflow_id: 'build.yml',
    ref: branch,
    inputs: {
      build_id: buildId,
      build_name: buildName,
    },
  });

  // Store metadata locally so we can later map artifact → frontend
  const meta = {
    buildId,
    branch,
    status: 'queued',
    createdAt: new Date().toISOString(),
    artifactPath: null,
    downloadUrl: null,
    name: buildName,
  };

  await fs.mkdir(path.join(config.artifactsDir, buildId), { recursive: true });
  await fs.writeFile(
    path.join(config.artifactsDir, buildId, 'meta.json'),
    JSON.stringify(meta, null, 2)
  );

  return { buildId, status: 'queued' };
}

/**
 * Poll GitHub for the workflow run status and download the artifact when ready.
 */
export async function pollAndFetchArtifact(buildId) {
  const metaPath = path.join(config.artifactsDir, buildId, 'meta.json');
  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));

  if (meta.status === 'success' && meta.artifactPath) {
    return meta;
  }

  // Find the latest workflow run on this branch
  const { data: runs } = await octokit.actions.listWorkflowRuns({
    owner: config.githubOwner,
    repo: config.githubRepo,
    workflow_id: 'build.yml',
    branch: meta.branch,
    per_page: 5,
  });

  const run = runs.workflow_runs[0];
  if (!run) {
    meta.status = 'queued';
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    return meta;
  }

  meta.status = run.status === 'completed'
    ? (run.conclusion === 'success' ? 'success' : 'failed')
    : run.status; // queued | in_progress

  if (meta.status !== 'success') {
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    return meta;
  }

  // Download the artifact
  const { data: artifacts } = await octokit.actions.listWorkflowRunArtifacts({
    owner: config.githubOwner,
    repo: config.githubRepo,
    run_id: run.id,
  });

  if (!artifacts.artifacts.length) {
    meta.status = 'failed';
    meta.error = 'No artifact produced';
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    return meta;
  }

  const artifact = artifacts.artifacts[0]; // take the first one
  const downloadResponse = await octokit.actions.downloadArtifact({
    owner: config.githubOwner,
    repo: config.githubRepo,
    artifact_id: artifact.id,
    archive_format: 'zip',
  });

  const artifactFile = path.join(config.artifactsDir, buildId, `${artifact.name}.zip`);
  const buffer = Buffer.from(await downloadResponse.arrayBuffer());
  await fs.writeFile(artifactFile, buffer);

  meta.status = 'success';
  meta.artifactPath = artifactFile;
  meta.artifactName = artifact.name;
  meta.finishedAt = new Date().toISOString();
  meta.downloadUrl = `/api/builds/${buildId}/download`;

  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));

  // Delete the temporary branch so source disappears from GitHub
  try {
    await octokit.git.deleteRef({
      owner: config.githubOwner,
      repo: config.githubRepo,
      ref: `heads/${meta.branch}`,
    });
  } catch (e) {
    console.warn('Could not delete temp branch:', e.message);
  }

  return meta;
}

/**
 * List recent successful builds (for “Latest builds” on the frontend)
 */
export async function listBuilds(limit = 20) {
  const dirs = await fs.readdir(config.artifactsDir).catch(() => []);
  const builds = [];

  for (const dir of dirs) {
    try {
      const meta = JSON.parse(
        await fs.readFile(path.join(config.artifactsDir, dir, 'meta.json'), 'utf8')
      );
      builds.push({
        buildId: meta.buildId,
        name: meta.name,
        status: meta.status,
        createdAt: meta.createdAt,
        finishedAt: meta.finishedAt || null,
        downloadUrl: meta.downloadUrl || null,
        artifactName: meta.artifactName || null,
      });
    } catch {
      // skip broken entries
    }
  }

  return builds
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

/**
 * Stream the artifact file to the client (after auth check)
 */
export async function getArtifactStream(buildId) {
  const metaPath = path.join(config.artifactsDir, buildId, 'meta.json');
  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
  if (meta.status !== 'success' || !meta.artifactPath) {
    throw new Error('Artifact not ready');
  }
  return {
    path: meta.artifactPath,
    name: meta.artifactName || 'artifact.zip',
  };
}
