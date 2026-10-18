import express from 'express';
import cors from 'cors';
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
app.use(cors());
app.use(express.json({ limit: '50mb' }));
await fs.mkdir(config.artifactsDir, { recursive: true });

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/builds', requireApiKey, async (req, res) => {
  try {
    const { sourceFiles = [], workflowContent, buildName } = req.body;
    if (!workflowContent) {
      return res.status(400).json({ error: 'workflowContent required' });
    }
    const result = await createBuild({
      sourceFiles,
      workflowContent,
      buildName: buildName || 'build',
    });
    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/builds', requireApiKey, async (_req, res) => {
  try {
    res.json(await listBuilds());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/builds/:id', requireApiKey, async (req, res) => {
  try {
    res.json(await pollAndFetchArtifact(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/builds/:id/download', requireApiKey, async (req, res) => {
  try {
    const { path: filePath, name } = await getArtifactStream(req.params.id);
    res.download(filePath, name);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.listen(config.port, () => {
  console.log(`GitBack on :${config.port}`);
});
