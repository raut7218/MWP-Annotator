import express from 'express';
import session from 'express-session';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import './src/db.js';
import { authRouter } from './src/routes/auth.js';
import { rowsRouter } from './src/routes/rows.js';
import { adminRouter } from './src/routes/admin.js';
import { requireLogin, requireAdmin } from './src/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

app.use(express.json({ limit: '1mb' }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 },
  })
);

app.use('/api', authRouter);
app.use('/api', requireLogin, rowsRouter);
app.use('/api/admin', requireLogin, requireAdmin, adminRouter);

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`MWP Annotator running at http://localhost:${PORT}`);
});
