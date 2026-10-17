import { config } from './config.js';

/**
 * Extremely simple protection: frontend just sends the shared API key.
 * No user accounts, no JWT, no site login on the backend.
 */
export function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== config.apiKey) {
    return res.status(401).json({ error: 'Invalid or missing X-API-Key' });
  }
  next();
}
