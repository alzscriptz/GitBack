import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: process.env.PORT || 4000,
  apiKey: process.env.API_KEY,
  // GitHub Actions secrets cannot be named GITHUB_* — use TOKEN
  githubToken: process.env.TOKEN || process.env.GITHUB_TOKEN,
  owner: process.env.GITHUB_OWNER || 'alzscriptz',
  repo: process.env.GITHUB_REPO || 'Gitback',
  artifactsDir: './artifacts',
};

if (!config.apiKey || !config.githubToken) {
  console.error('Missing required env: API_KEY and TOKEN');
  process.exit(1);
}
