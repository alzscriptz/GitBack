# GitBack – Zero-Leak Actions Backend

Secure bridge between your **liquid-glass private site** and real GitHub Actions.

## Design goals (0 leak / 0 code exposure)

1. Source code is pushed **only** into a private GitHub repository on a temporary branch.
2. GitHub Actions runs the build on GitHub’s runners.
3. When the Action finishes, **only the artifact** is downloaded.
4. The temporary branch is deleted → source disappears from GitHub.
5. Frontend never receives source, logs, or workflow details – only a clean download link under “Latest builds”.
6. **Everything originates from the site.** The backend never exposes project source.

## Quick start

```bash
cp .env.example .env
# edit .env → put your GitHub token + owner + private build-engine repo
npm install
npm start
```

### Required GitHub setup

1. Create a **private** empty repository that will act as the temporary build engine (e.g. `gitback-build-engine`).
2. Create a Personal Access Token with:
   - `repo` (full control)
   - `workflow`
   - `actions:read` + `actions:write`
3. Put the values in `.env`.

### API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST   | `/api/login` | – | `{ username, password }` → JWT |
| POST   | `/api/builds` | Bearer | Create a new build (send `workflowContent` + optional `sourceFiles`) |
| GET    | `/api/builds` | Bearer | List recent builds |
| GET    | `/api/builds/:id` | Bearer | Poll status + auto-fetch artifact |
| GET    | `/api/builds/:id/download` | Bearer | Download the finished artifact |

### Example create-build body

```json
{
  "buildName": "My iOS App",
  "workflowContent": "name: build\non:\n  workflow_dispatch: ...",
  "sourceFiles": [
    {
      "path": "src/main.swift",
      "content": "print(\"hello\")",
      "encoding": "utf8"
    }
  ]
}
```

The sample workflow lives in `workflows/sample-build.yml`.

## Security notes

- Source never returns to the frontend.
- Artifacts are the only thing the site ever sees.
- Temporary branches are deleted after the artifact is fetched.
- JWT protects every endpoint that can touch builds.
