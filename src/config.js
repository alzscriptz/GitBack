import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: process.env.PORT || 4000,
  apiKey: process.env.API_KEY || 'change-me',
  githubToken: process.env.GITHUB_TOKEN,
  githubOwner: process.env.GITHUB_OWNER,
  githubRepo: process.env.GITHUB_REPO,
  artifactsDir: process.env.ARTIFACTS_DIR || './artifacts-store',
};
