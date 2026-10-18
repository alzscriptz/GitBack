# GitBack – Pure Actions Backend

**Only job:** run GitHub Actions and return the finished artifact.

Frontend (liquid-glass site) → GitBack → private `build-engine` repo → artifact only.

## Secrets you must set (`.env`)

Copy `.env.example` → `.env` and fill:

```env
PORT=4000

# Shared secret — same value goes in the site Settings → API Key
API_KEY=pick-a-long-random-string-here

# GitHub PAT (classic) with scopes: repo + workflow
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Your account + the private build-engine repo (already created)
GITHUB_OWNER=alzscriptz
GITHUB_REPO=build-engine

ARTIFACTS_DIR=./artifacts-store
```

### Create the PAT
1. https://github.com/settings/tokens → **Generate new token (classic)**
2. Scopes: **`repo`** (full) + **`workflow`**
3. Paste as `GITHUB_TOKEN`

### Private build engine
Already created: https://github.com/alzscriptz/build-engine  
GitBack pushes temp branches there, runs Actions, downloads the artifact, then deletes the branch (zero source leak).

## Run locally

```bash
cd Gitback
cp .env.example .env
# edit .env with the values above
npm install
npm start
# → http://localhost:4000
```

Health check: `GET http://localhost:4000/health`

## Wire the site (gitlab-liquid)

1. Open https://gitlab-liquid-alzscriptzs-projects.vercel.app
2. Sign in → **Settings**
3. Backend URL: `http://localhost:4000` (or your hosted URL)
4. API Key: same as `API_KEY` in GitBack `.env`
5. Save → open a repo → **Run Action**

## API (all need header `X-API-Key`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/builds` | Start a build |
| GET | `/api/builds` | List recent builds |
| GET | `/api/builds/:id` | Status + fetch artifact |
| GET | `/api/builds/:id/download` | Download artifact |

Host GitBack anywhere that runs Node continuously (local, Railway, Render, VPS). Vercel serverless is a poor fit because builds poll for minutes and store files on disk.
