import bcrypt from 'bcryptjs';
import { get } from './db.js';

export async function verifyLogin(username, password) {
  const user = await get('SELECT * FROM users WHERE username = ? AND active = 1', [username]);
  if (!user) return null;
  if (!bcrypt.compareSync(password, user.password_hash)) return null;
  return sanitize(user);
}

export async function userById(id) {
  const user = await get('SELECT * FROM users WHERE id = ? AND active = 1', [id]);
  return user ? sanitize(user) : null;
}

function sanitize(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    languages: JSON.parse(user.languages || '[]'),
    models: JSON.parse(user.models || '[]'),
    isAdmin: !!user.is_admin,
    // Admins always see model names; for annotators it is an admin-set switch.
    canSeeModel: !!user.is_admin || !!user.can_see_model,
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

export function userModels(user) {
  if (!user) return [];
  if (user.isAdmin || user.models.includes('*')) return null; // null = all
  return user.models;
}

export function canAccessModel(user, model) {
  if (!user) return false;
  if (user.isAdmin || user.models.includes('*')) return true;
  return user.models.includes(model);
}

export async function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const user = await userById(req.session.userId);
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
