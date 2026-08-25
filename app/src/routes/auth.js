import { Router } from 'express';
import { verifyLogin, userById } from '../auth.js';

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const user = await verifyLogin(String(username).trim(), String(password));
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });
  req.session.userId = user.id;
  res.json({ user });
});

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

authRouter.get('/me', async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = await userById(req.session.userId);
  if (!user) return res.json({ user: null });
  res.json({ user });
});
