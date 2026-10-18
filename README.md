# GitBack

Actions run **on this repo**. Artifact goes to the site only. Temp branch deleted after.

## Secrets (2 only)

| Name | What |
|------|------|
| `API_KEY` | Random string. Same value in **site Settings → API Key**. |
| `TOKEN` | GitHub PAT with **`repo`** + **`workflow`**. (Do not name it `GITHUB_TOKEN` — GitHub blocks that name for secrets.) |

Defaults: owner `alzscriptz`, repo `Gitback`, port `4000`.

```bash
npm install
export API_KEY="your-random-string"
export TOKEN="ghp_..."
npm start
```

Site Settings: only **API Key** (backend is fixed to the server you run).
