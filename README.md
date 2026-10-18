# GitBack

Runs GitHub Actions. Returns only the artifact. Public code, no secrets in git.

## Secrets (only 2 required)

Set as **environment variables** on the machine/host (or a local `.env` that is gitignored):

| Name | What |
|------|------|
| `API_KEY` | Any random string. Same value in the site Settings. |
| `GITHUB_TOKEN` | GitHub PAT with **`repo`** + **`workflow`** scopes. |

Optional (defaults already set):

| Name | Default |
|------|---------|
| `GITHUB_OWNER` | `alzscriptz` |
| `GITHUB_REPO` | `build-engine` |
| `PORT` | `4000` |

Create PAT: https://github.com/settings/tokens → classic → scopes `repo` + `workflow`

## Run

```bash
npm install
export API_KEY="your-random-string"
export GITHUB_TOKEN="ghp_..."
npm start
```

Or put those two in a `.env` file (never commit it).

## Site

Settings → Backend URL = `http://localhost:4000` (or your host URL)  
Settings → API Key = same as `API_KEY`

## API

All need header `X-API-Key`:

- `POST /api/builds` body: `{ workflowContent, sourceFiles?, buildName? }`
- `GET /api/builds/:id` — status / pulls artifact when done
- `GET /api/builds/:id/download`
- `GET /api/builds`
