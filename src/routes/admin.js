const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

function adminAuth(req, res, next) {
  const key = req.query.key || req.headers['x-admin-key'];
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(401).send('Acesso negado.');
  }
  next();
}

router.get('/', adminAuth, async (req, res) => {
  try {
  const now = new Date();

  const [users, subscriptions] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: { subscription: true },
    }),
    prisma.subscription.findMany(),
  ]);

  const total = users.length;
  const active = subscriptions.filter(s => s.status === 'active' && s.currentPeriodEnd > now).length;
  const trial = subscriptions.filter(s => s.status === 'trial' && s.trialEndsAt > now).length;
  const trialExpired = subscriptions.filter(s => s.status === 'trial' && s.trialEndsAt <= now).length;
  const canceled = subscriptions.filter(s => s.status === 'canceled').length;

  const statusLabel = (sub) => {
    if (!sub) return '<span style="color:#888">Sem plano</span>';
    if (sub.status === 'active') return '<span style="color:#2ecc71;font-weight:700">✅ Assinante</span>';
    if (sub.status === 'trial' && sub.trialEndsAt > now) return '<span style="color:#f39c12;font-weight:700">⏳ Trial</span>';
    if (sub.status === 'trial' && sub.trialEndsAt <= now) return '<span style="color:#e74c3c;font-weight:700">❌ Trial expirado</span>';
    if (sub.status === 'canceled') return '<span style="color:#e74c3c">🚫 Cancelou</span>';
    return `<span style="color:#888">${sub.status}</span>`;
  };

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '—';

  const rows = users.map(u => `
    <tr>
      <td>${u.name}</td>
      <td>${u.email}</td>
      <td>${u.phone || '<span style="color:#ccc">—</span>'}</td>
      <td>${statusLabel(u.subscription)}</td>
      <td>${u.subscription?.trialEndsAt ? formatDate(u.subscription.trialEndsAt) : '—'}</td>
      <td>${u.subscription?.currentPeriodEnd ? formatDate(u.subscription.currentPeriodEnd) : '—'}</td>
      <td>${formatDate(u.createdAt)}</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Viva — Painel Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8f0f4; color: #333; }
    header { background: linear-gradient(135deg, #C96A8A, #7B6EA8); padding: 24px 32px; color: white; }
    header h1 { font-size: 24px; font-weight: 800; }
    header p { opacity: 0.8; font-size: 14px; margin-top: 4px; }
    .cards { display: flex; gap: 16px; padding: 24px 32px; flex-wrap: wrap; }
    .card { background: white; border-radius: 16px; padding: 20px 24px; flex: 1; min-width: 140px; box-shadow: 0 2px 8px rgba(0,0,0,0.07); }
    .card-num { font-size: 36px; font-weight: 900; color: #C96A8A; }
    .card-label { font-size: 13px; color: #888; margin-top: 4px; }
    .section { padding: 0 32px 32px; }
    .section h2 { font-size: 18px; font-weight: 700; margin-bottom: 16px; color: #444; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.07); }
    th { background: #C96A8A; color: white; padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 600; }
    td { padding: 12px 16px; font-size: 14px; border-bottom: 1px solid #f5e6ef; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #fff5f8; }
    .refresh { float: right; background: white; border: 2px solid #C96A8A; color: #C96A8A; padding: 8px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; text-decoration: none; font-size: 14px; }
  </style>
</head>
<body>
  <header>
    <h1>🌸 Viva — Painel Admin</h1>
    <p>Atualizado em ${new Date().toLocaleString('pt-BR')}</p>
  </header>

  <div class="cards">
    <div class="card"><div class="card-num">${total}</div><div class="card-label">Total de usuárias</div></div>
    <div class="card"><div class="card-num" style="color:#2ecc71">${active}</div><div class="card-label">Assinantes ativas</div></div>
    <div class="card"><div class="card-num" style="color:#f39c12">${trial}</div><div class="card-label">Em trial</div></div>
    <div class="card"><div class="card-num" style="color:#e74c3c">${trialExpired}</div><div class="card-label">Trial expirado</div></div>
    <div class="card"><div class="card-num" style="color:#e74c3c">${canceled}</div><div class="card-label">Cancelaram</div></div>
  </div>

  <div class="section">
    <h2>Todas as usuárias <a class="refresh" href="?key=${req.query.key}">↻ Atualizar</a></h2>
    <table>
      <thead>
        <tr>
          <th>Nome</th>
          <th>Email</th>
          <th>Telefone</th>
          <th>Status</th>
          <th>Trial até</th>
          <th>Renova em</th>
          <th>Cadastro</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</body>
</html>`;

  res.send(html);
  } catch (err) {
    console.error('Admin error:', err);
    res.status(500).send(`<pre>Erro: ${err.message}</pre>`);
  }
});

module.exports = router;
