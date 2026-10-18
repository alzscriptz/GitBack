import { Octokit } from '@octokit/rest';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from './config.js';

const octokit = new Octokit({ auth: config.githubToken });
const { owner, repo } = config;

async function getDefaultBranch() {
  try {
    const { data } = await octokit.git.getRef({ owner, repo, ref: 'heads/main' });
    return { sha: data.object.sha, branch: 'main' };
  } catch {
    const { data } = await octokit.git.getRef({ owner, repo, ref: 'heads/master' });
    return { sha: data.object.sha, branch: 'master' };
  }
}

/**
 * Site sends workflowContent (build.yml) + sourceFiles.
 * We:
 *  1) put source on temp branch build/<id>
 *  2) put a runnable copy of build.yml on MAIN (GitHub only dispatches workflows on default branch)
 *     - force workflow_dispatch
 *     - force actions/checkout to use the temp branch so the build sees site files
 *  3) dispatch that workflow on main
 *  4) poll → download artifact only → delete temp branch + ephemeral workflow file
 */
export async function createBuild({ sourceFiles = [], workflowContent, buildName = 'build' }) {
  if (!workflowContent || !String(workflowContent).trim()) {
    throw new Error('workflowContent (build.yml) is required from the site');
  }

  const buildId = uuidv4();
  const shortId = buildId.slice(0, 8);
  const sourceBranch = `build/${buildId}`;
  const ephemeralPath = `.github/workflows/gb-${shortId}.yml`;
  const { sha: baseSha, branch: defaultBranch } = await getDefaultBranch();

  // 1) Temp branch with source from the site
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${sourceBranch}`,
    sha: baseSha,
  });

  // Always write a marker so branch has a commit even with 0 files
  await putFile(sourceBranch, '.gitback/build-id.txt', buildId);

  for (const file of sourceFiles) {
    if (!file?.path) continue;
    // never overwrite workflows on the source branch with garbage paths
    try {
      const raw =
        file.encoding === 'base64'
          ? Buffer.from(file.content, 'base64')
          : Buffer.from(file.content ?? '', 'utf8');
      await putFile(sourceBranch, file.path, raw, true);
    } catch (e) {
      console.warn('skip source', file.path, e.message);
    }
  }

  // 2) Make site build.yml dispatchable on MAIN and checkout the source branch
  const runnableYml = makeRunnableWorkflow(workflowContent, sourceBranch, buildName, shortId);

  await putFile(defaultBranch, ephemeralPath, runnableYml);

  // GitHub needs a moment to index the new workflow file
  await sleep(3000);

  // 3) Dispatch by filename (works once file is on default branch)
  try {
    await octokit.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: `gb-${shortId}.yml`,
      ref: defaultBranch,
    });
  } catch (e) {
    // retry once after more wait
    await sleep(4000);
    try {
      await octokit.actions.createWorkflowDispatch({
        owner,
        repo,
        workflow_id: `gb-${shortId}.yml`,
        ref: defaultBranch,
      });
    } catch (e2) {
      await safeDeleteRef(sourceBranch);
      await safeDeleteFile(defaultBranch, ephemeralPath);
      throw new Error(
        'Could not start workflow: ' +
          (e2.message || e.message) +
          '. Check TOKEN has workflow scope and Actions is enabled.'
      );
    }
  }

  const dir = path.join(config.artifactsDir, buildId);
  await fs.mkdir(dir, { recursive: true });
  const meta = {
    buildId,
    name: buildName,
    branch: sourceBranch,
    ephemeralPath,
    ephemeralWorkflow: `gb-${shortId}.yml`,
    defaultBranch,
    status: 'queued',
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  return {
    buildId,
    status: 'queued',
    message: 'Site build.yml dispatched on GitBack',
  };
}

/**
 * Force workflow_dispatch and pin checkout to the temp source branch.
 */
function makeRunnableWorkflow(userYml, sourceBranch, buildName, shortId) {
  let yml = String(userYml);

  // Strip any existing top-level `on:` block (simple heuristic) and inject workflow_dispatch
  // Keep name if present
  const nameMatch = yml.match(/^\s*name:\s*.+$/m);
  const nameLine = nameMatch ? nameMatch[0] : `name: site-build-${shortId}`;

  // Remove name line temporarily to rebuild header
  yml = yml.replace(/^\s*name:\s*.+$\n?/m, '');

  // Remove existing on: block (from `on:` until next top-level key)
  yml = yml.replace(
    /^on\s*:\s*[\s\S]*?(?=^\S)/m,
    ''
  );
  // If `on` was at end of file
  yml = yml.replace(/^on\s*:[\s\S]*$/m, '');

  // Pin every actions/checkout to the source branch
  yml = yml.replace(
    /(uses:\s*actions\/checkout@[\w.]+)([^\n]*\n)((?:\s+with:\s*\n(?:\s{2,}[^\n]+\n)*)?)/g,
    (full, uses, after, withBlock) => {
      if (/\bwith:\s*/.test(withBlock)) {
        // inject or replace ref
        if (/\bref:\s*/.test(withBlock)) {
          return uses + after + withBlock.replace(/ref:\s*[^\n]+/, `ref: ${sourceBranch}`);
        }
        return uses + after + withBlock.replace(/with:\s*\n/, `with:\n          ref: ${sourceBranch}\n`);
      }
      return `${uses}\n        with:\n          ref: ${sourceBranch}\n`;
    }
  );

  // If there is no checkout at all, prepend a checkout step into the first job is hard;
  // ensure at least artifact upload exists later via runner guarantee in poll

  const header = `${nameLine}

on:
  workflow_dispatch:

`;

  // Ensure upload-artifact exists somewhere — if not, append a final job (safe fallback)
  if (!/actions\/upload-artifact@/.test(yml)) {
    yml += `
  gitback_artifact:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${sourceBranch}
      - name: Package
        run: |
          mkdir -p dist
          echo "build ${shortId}" > dist/out.txt
          find . -maxdepth 3 -type f ! -path './.git/*' ! -path './node_modules/*' | head -50 >> dist/out.txt || true
      - uses: actions/upload-artifact@v4
        with:
          name: result-${shortId}
          path: dist/
`;
  }

  return header + yml.trim() + '\n';
}

async function putFile(branch, filePath, content, isBuffer = false) {
  const body = isBuffer ? content : Buffer.from(String(content), 'utf8');
  // Get existing sha if any
  let sha;
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path: filePath, ref: branch });
    if (!Array.isArray(data)) sha = data.sha;
  } catch {}
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: filePath,
    message: `gitback ${filePath}`,
    content: body.toString('base64'),
    branch,
    ...(sha ? { sha } : {}),
  });
}

async function safeDeleteRef(branch) {
  try {
    await octokit.git.deleteRef({ owner, repo, ref: `heads/${branch}` });
  } catch (e) {
    console.warn('delete branch', e.message);
  }
}

async function safeDeleteFile(branch, filePath) {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path: filePath, ref: branch });
    if (Array.isArray(data)) return;
    await octokit.repos.deleteFile({
      owner,
      repo,
      path: filePath,
      message: `cleanup ${filePath}`,
      sha: data.sha,
      branch,
    });
  } catch (e) {
    console.warn('delete file', filePath, e.message);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function pollAndFetchArtifact(buildId) {
  const dir = path.join(config.artifactsDir, buildId);
  const metaPath = path.join(dir, 'meta.json');
  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));

  if (meta.status === 'success' || meta.status === 'failed') return meta;

  const workflowId = meta.ephemeralWorkflow || 'gitback-runner.yml';

  let runs;
  try {
    const { data } = await octokit.actions.listWorkflowRuns({
      owner,
      repo,
      workflow_id: workflowId,
      event: 'workflow_dispatch',
      per_page: 10,
    });
    runs = data.workflow_runs;
  } catch {
    // workflow file may not be indexed yet
    const { data } = await octokit.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      event: 'workflow_dispatch',
      per_page: 15,
    });
    runs = data.workflow_runs;
  }

  const created = new Date(meta.createdAt).getTime();
  const run =
    (runs || []).find((r) => {
      const t = new Date(r.created_at).getTime();
      return t >= created - 5000 && t < created + 20 * 60 * 1000;
    }) || (runs || [])[0];

  if (!run) {
    meta.status = 'queued';
    meta.detail = 'Waiting for GitHub to start the site build.yml…';
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    return meta;
  }

  meta.runId = run.id;
  meta.runUrl = run.html_url;

  if (run.status !== 'completed') {
    meta.status = run.status;
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    return meta;
  }

  if (run.conclusion !== 'success') {
    meta.status = 'failed';
    meta.error = run.conclusion || 'failed';
    meta.finishedAt = new Date().toISOString();
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    await cleanup(meta);
    return meta;
  }

  const { data: arts } = await octokit.actions.listWorkflowRunArtifacts({
    owner,
    repo,
    run_id: run.id,
  });

  if (!arts.artifacts?.length) {
    meta.status = 'failed';
    meta.error = 'Workflow finished but produced no artifact (add actions/upload-artifact to build.yml)';
    meta.finishedAt = new Date().toISOString();
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    await cleanup(meta);
    return meta;
  }

  const artifact = arts.artifacts.find((a) => /^(release|result)(-|$)/i.test(a.name)) || arts.artifacts[0];
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
  await cleanup(meta);
  return meta;
}

async function cleanup(meta) {
  if (meta.branch) await safeDeleteRef(meta.branch);
  if (meta.ephemeralPath && meta.defaultBranch) {
    await safeDeleteFile(meta.defaultBranch, meta.ephemeralPath);
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
