import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: process.env.PORT || 4000,
  apiKey: process.env.API_KEY,
  githubToken: process.env.GITHUB_TOKEN,
  // Actions run ON this same public repo (temp branches only)
  owner: process.env.GITHUB_OWNER || 'alzscriptz',
  repo: process.env.GITHUB_REPO || 'Gitback',
  artifactsDir: './artifacts',
};

if (!config.apiKey || !config.githubToken) {
  console.error('Missing required env: API_KEY and GITHUB_TOKEN');
  process.exit(1);
}
