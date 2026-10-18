# GitBack

**One public repo.** Actions run here. Artifacts go to the site only. Nothing stays in the repo.

## Flow

1. Site sends `workflowContent` + optional source files + API key  
2. GitBack creates a **temp branch** `build/<id>` on **this repo**  
3. GitHub Actions runs on that branch  
4. Backend downloads the **artifact only** → serves it to the site  
5. Temp branch is **deleted** (source gone from the repo)

No separate build-engine. No artifacts left on GitHub for the site to scrape — the site gets the file from GitBack’s download endpoint.

## Secrets (only 2)

| Name | What |
|------|------|
| `API_KEY` | Random string. Same value in site Settings. |
| `GITHUB_TOKEN` | PAT with **`repo`** + **`workflow`**. |

Defaults (no need to set): `GITHUB_OWNER=alzscriptz`, `GITHUB_REPO=Gitback`, `PORT=4000`

Token: https://github.com/settings/tokens → classic → `repo` + `workflow`

## Run

```bash
npm install
export API_KEY="your-random-string"
export GITHUB_TOKEN="ghp_..."
npm start
```

## Site

- Backend URL → where this server runs  
- API Key → same as `API_KEY`

## API (`X-API-Key` header)

- `POST /api/builds` `{ workflowContent, sourceFiles?, buildName? }`
- `GET /api/builds/:id`
- `GET /api/builds/:id/download`
- `GET /api/builds`
