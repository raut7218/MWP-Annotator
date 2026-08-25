const form = document.getElementById('loginForm');
const errorBox = document.getElementById('errorBox');

// If already logged in, skip straight to the right place.
fetch('/api/me').then((r) => r.json()).then(({ user }) => {
  if (user) window.location.href = user.isAdmin ? 'admin.html' : 'annotate.html';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.innerHTML = '';
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const btn = form.querySelector('button');
  btn.disabled = true;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    window.location.href = data.user.isAdmin ? 'admin.html' : 'annotate.html';
  } catch (err) {
    errorBox.innerHTML = `<div class="error-msg">${escapeHtml(err.message)}</div>`;
    btn.disabled = false;
  }
});

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
