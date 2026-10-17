# GitBack – Pure Actions Backend

**Only job:** run GitHub Actions and return the finished artifact.

No site login. No user accounts. No UI.  
Everything visual + private-site login lives on the liquid-glass frontend.

## What it does

1. Frontend sends source + `build.yml` + API key
2. Backend creates a temporary private branch, triggers the Action
3. When finished → downloads **only** the artifact
4. Deletes the temporary branch (source is gone)
5. Frontend gets a clean download link

Zero source leak. Public repo = free unlimited Actions minutes.

## Setup

```bash
cp .env.example .env
# fill in API_KEY + GitHub token + private build-engine repo
npm install
npm start
```

## API (all protected by `X-API-Key` header)

| Method | Path | Description |
|--------|------|-------------|
| POST   | `/api/builds` | Start a build |
| GET    | `/api/builds` | List recent builds |
| GET    | `/api/builds/:id` | Status + auto-fetch artifact |
| GET    | `/api/builds/:id/download` | Download the artifact |

That’s the entire backend.
