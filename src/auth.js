import jwt from 'jsonwebtoken';
import { config } from './config.js';

export function login(req, res) {
  const { username, password } = req.body;
  if (
    username === config.siteUsername &&
    password === config.sitePassword
  ) {
    const token = jwt.sign(
      { sub: username, role: 'owner' },
      config.jwtSecret,
      { expiresIn: '7d' }
    );
    return res.json({ token, username });
  }
  return res.status(401).json({ error: 'Invalid credentials' });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
