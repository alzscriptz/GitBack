import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'fs/promises';
import { config } from './config.js';
import { requireApiKey } from './auth.js';
import {
  createBuild,
  pollAndFetchArtifact,
  listBuilds,
  getArtifactStream,
} from './github-actions.js';

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors()); // frontend will call this from anywhere
app.use(express.json({ limit: '50mb' }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use(limiter);

await fs.mkdir(config.artifactsDir, { recursive: true });

// Health check (public)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'gitback-actions' });
});

// Everything below requires the shared API key
app.post('/api/builds', requireApiKey, async (req, res) => {
  try {
    const { sourceFiles = [], workflowContent, buildName } = req.body;
    if (!workflowContent) {
      return res.status(400).json({ error: 'workflowContent is required' });
    }
    const result = await createBuild({
      sourceFiles,
      workflowContent,
      buildName: buildName || 'unnamed-build',
    });
    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/builds', requireApiKey, async (req, res) => {
  try {
    res.json(await listBuilds(30));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/builds/:buildId', requireApiKey, async (req, res) => {
  try {
    res.json(await pollAndFetchArtifact(req.params.buildId));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.get('/api/builds/:buildId/download', requireApiKey, async (req, res) => {
  try {
    const { path: filePath, name } = await getArtifactStream(req.params.buildId);
    res.download(filePath, `${name}.zip`);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Background poller
setInterval(async () => {
  try {
    const builds = await listBuilds(50);
    for (const b of builds) {
      if (b.status === 'queued' || b.status === 'in_progress') {
        await pollAndFetchArtifact(b.buildId).catch(() => {});
      }
    }
  } catch {}
}, 30_000);

app.listen(config.port, () => {
  console.log(`Gitback Actions backend on :${config.port}`);
});
