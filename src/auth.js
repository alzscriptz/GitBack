import { config } from './config.js';

export function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== config.apiKey) {
    return res.status(401).json({ error: 'Invalid or missing X-API-Key' });
  }
  next();
}
