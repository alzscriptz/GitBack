import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: process.env.PORT || 4000,
  siteUsername: process.env.SITE_USERNAME || 'admin',
  sitePassword: process.env.SITE_PASSWORD || 'change-me',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  githubToken: process.env.GITHUB_TOKEN,
  githubOwner: process.env.GITHUB_OWNER,
  githubRepo: process.env.GITHUB_REPO,
  artifactsDir: process.env.ARTIFACTS_DIR || './artifacts-store',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
};
