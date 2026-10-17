import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { login, requireAuth } from './auth.js';
import {
  createBuild,
  pollAndFetchArtifact,
  listBuilds,
  getArtifactStream,
} from './github-actions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Security
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: config.frontendOrigin,
  credentials: true,
}));
app.use(express.json({ limit: '50mb' })); // source files can be large
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});
app.use(limiter);

// Ensure artifacts dir exists
await fs.mkdir(config.artifactsDir, { recursive: true });

// ---------- Public routes ----------
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'gitback-backend' });
});

app.post('/api/login', login);

// ---------- Protected routes ----------
app.post('/api/builds', requireAuth, async (req, res) => {
  try {
    const { sourceFiles = [], workflowContent, buildName } = req.body;

    if (!workflowContent) {
      return res.status(400).json({ error: 'workflowContent (build.yml) is required' });
    }

    const result = await createBuild({
      sourceFiles,
      workflowContent,
      buildName: buildName || 'unnamed-build',
    });

    res.status(201).json(result);
  } catch (err) {
    console.error('createBuild error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/builds', requireAuth, async (req, res) => {
  try {
    const builds = await listBuilds(30);
    res.json(builds);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/builds/:buildId', requireAuth, async (req, res) => {
  try {
    const meta = await pollAndFetchArtifact(req.params.buildId);
    res.json(meta);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.get('/api/builds/:buildId/download', requireAuth, async (req, res) => {
  try {
    const { path: filePath, name } = await getArtifactStream(req.params.buildId);
    res.download(filePath, `${name}.zip`);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Simple background poller (every 30s) so artifacts appear even if frontend is closed
setInterval(async () => {
  try {
    const builds = await listBuilds(50);
    for (const b of builds) {
      if (b.status === 'queued' || b.status === 'in_progress') {
        await pollAndFetchArtifact(b.buildId).catch(() => {});
      }
    }
  } catch (e) {
    // ignore
  }
}, 30_000);

app.listen(config.port, () => {
  console.log(`\n🚀 Gitback backend running on http://localhost:${config.port}`);
  console.log(`   Health  → GET  /health`);
  console.log(`   Login   → POST /api/login`);
  console.log(`   Builds  → POST /api/builds  (auth required)`);
  console.log(`   List    → GET  /api/builds`);
  console.log(`   Status  → GET  /api/builds/:id`);
  console.log(`   Download→ GET  /api/builds/:id/download\n`);
});
