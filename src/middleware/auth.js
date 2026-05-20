const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação necessário.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) {
      return res.status(401).json({ error: 'Usuária não encontrada.' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}

async function subscriptionMiddleware(req, res, next) {
  const sub = await prisma.subscription.findUnique({ where: { userId: req.user.id } });
  if (!sub) {
    return res.status(403).json({ error: 'Assinatura necessária para acessar este recurso.' });
  }

  const now = new Date();
  const isTrialValid = sub.status === 'trial' && sub.trialEndsAt && sub.trialEndsAt > now;
  const isActive = sub.status === 'active' && sub.currentPeriodEnd && sub.currentPeriodEnd > now;

  if (!isTrialValid && !isActive) {
    return res.status(403).json({ error: 'Sua assinatura expirou. Renove para continuar.' });
  }
  next();
}

module.exports = { authMiddleware, subscriptionMiddleware };
