# GitBack

Actions run **on this repo**. Artifact goes to the site only. Temp branch deleted after.

## Why “no workflow ran” before

GitHub **only runs workflows that exist on the default branch (`main`)**.  
Putting `build.yml` only on a temp branch does **nothing**.

**Fix:** permanent `.github/workflows/gitback-runner.yml` on `main`.

Flow:
1. Site → GitBack API  
2. Temp branch `build/<id>` with source  
3. Dispatch **GitBack Runner** on `main` with input = that branch  
4. Runner checks out temp branch → builds → uploads artifact  
5. GitBack downloads artifact for the site → deletes temp branch  

## Secrets (2 only)

| Name | What |
|------|------|
| `API_KEY` | Random string (same in site Settings) |
| `TOKEN` | PAT with **`repo`** + **`workflow`** |

```bash
npm install
export API_KEY="your-random-string"
export TOKEN="ghp_..."
npm start
```

Restart GitBack after pulling these fixes.

## First time on GitHub

Open https://github.com/alzscriptz/Gitback/actions and enable Actions if prompted.
