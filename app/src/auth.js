import bcrypt from 'bcryptjs';
import { db } from './db.js';

const getByUsername = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1');
const getById = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1');

export function verifyLogin(username, password) {
  const user = getByUsername.get(username);
  if (!user) return null;
  if (!bcrypt.compareSync(password, user.password_hash)) return null;
  return sanitize(user);
}

export function userById(id) {
  const user = getById.get(id);
  return user ? sanitize(user) : null;
}

function sanitize(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    languages: JSON.parse(user.languages || '[]'),
    isAdmin: !!user.is_admin,
  };
}

export function userLanguages(user) {
  if (!user) return [];
  if (user.isAdmin || user.languages.includes('*')) return null; // null = all
  return user.languages;
}

export function canAccessLanguage(user, language) {
  if (!user) return false;
  if (user.isAdmin || user.languages.includes('*')) return true;
  return user.languages.includes(language);
}

export function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const user = userById(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Session invalid' });
  }
  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin only' });
  next();
}
