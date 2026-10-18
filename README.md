# GitBack – Pure Actions Backend (public code, private secrets)

**Public repo = zero secrets in git.**  
Code is public. Tokens live only in host env / GitHub Settings / site Settings.

## Where secrets go (NOT in the repo)

| Secret | Where you put it |
|--------|------------------|
| `GITHUB_TOKEN` | **Host** env vars (Railway/Render/VPS) when you deploy GitBack. Locally: your machine’s env or a **gitignored** `.env` you never commit. |
| `API_KEY` | Same host env **and** the **site Settings → API Key** (same value both places). |
| `GITHUB_OWNER` / `GITHUB_REPO` | Host env: `alzscriptz` / `build-engine` |

### Optional: GitHub repo Settings secrets
On **private** `build-engine` only (if a workflow needs them):

**https://github.com/alzscriptz/build-engine/settings/secrets/actions**

→ New repository secret. Names like `API_KEY` are for Actions workflows, **not** automatically loaded by the Node server.

The Node server only reads **process environment** at runtime (from the host or a local gitignored `.env`).

## Create the PAT (you do this once)
1. https://github.com/settings/tokens → classic token  
2. Scopes: **`repo`** + **`workflow`**  
3. Put it in the **host** as `GITHUB_TOKEN` — never commit it, never paste it in issues/chat.

## Local run (secrets stay on your machine)

```bash
git clone https://github.com/alzscriptz/Gitback.git
cd Gitback
cp .env.example .env   # gitignored — fill locally only
# API_KEY=...  GITHUB_TOKEN=...  GITHUB_OWNER=alzscriptz  GITHUB_REPO=build-engine
npm install && npm start
```

## Wire the site
1. Site: https://gitlab-liquid-alzscriptzs-projects.vercel.app → **Settings**  
2. Backend URL = where GitBack is running  
3. API Key = same as host `API_KEY`  
4. Run Action on a repo

## Flow
Site (API key in Settings) → GitBack (token in host env) → private `build-engine` temp branch → artifact only → branch deleted.

`.env` is in `.gitignore`. Public clone never contains secrets.
