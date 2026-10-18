import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: process.env.PORT || 4000,
  apiKey: process.env.API_KEY,
  githubToken: process.env.GITHUB_TOKEN,
  owner: process.env.GITHUB_OWNER || 'alzscriptz',
  repo: process.env.GITHUB_REPO || 'build-engine',
  artifactsDir: './artifacts',
};

if (!config.apiKey || !config.githubToken) {
  console.error('Missing required env: API_KEY and GITHUB_TOKEN');
  process.exit(1);
}
