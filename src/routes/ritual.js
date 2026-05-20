const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware/auth');
const { generateDailyRitual } = require('../services/anthropic');

const router = express.Router();
const prisma = new PrismaClient();

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

async function calculateStreak(userId) {
  const completed = await prisma.dailyRitual.findMany({
    where: { userId, completed: true },
    orderBy: { date: 'desc' },
    select: { date: true },
    take: 365,
  });

  if (!completed.length) return 0;

  const completedSet = new Set(completed.map(r => r.date));
  let streak = 0;

  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  // Se hoje está completo começa por hoje, senão começa por ontem
  const today = cursor.toISOString().split('T')[0];
  if (!completedSet.has(today)) {
    cursor.setDate(cursor.getDate() - 1);
  }

  while (true) {
    const d = cursor.toISOString().split('T')[0];
    if (completedSet.has(d)) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

async function getLast7Days(userId) {
  const days = [];
  const base = new Date();
  base.setHours(0, 0, 0, 0);

  for (let i = 6; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }

  const rituals = await prisma.dailyRitual.findMany({
    where: { userId, date: { in: days } },
    select: { date: true, completed: true },
  });

  const map = new Map(rituals.map(r => [r.date, r.completed]));
  const today = days[6];

  return days.map(date => ({
    date,
    completed: map.get(date) || false,
    isToday: date === today,
  }));
}

// GET /ritual/today — busca ou gera o ritual do dia
router.get('/today', authMiddleware, async (req, res) => {
  try {
    const today = todayStr();

    let ritual = await prisma.dailyRitual.findUnique({
      where: { userId_date: { userId: req.user.id, date: today } },
    });

    if (!ritual) {
      const user = await prisma.user.findUnique({ where: { id: req.user.id } });

      const lastCheckin = await prisma.dailyCheckin.findFirst({
        where: { userId: req.user.id },
        orderBy: { date: 'desc' },
      });

      const recentRituals = await prisma.dailyRitual.findMany({
        where: { userId: req.user.id },
        orderBy: { date: 'desc' },
        select: { challenge: true },
        take: 7,
      });

      const generated = await generateDailyRitual({
        user,
        lastCheckin,
        recentChallenges: recentRituals.map(r => r.challenge),
      });

      ritual = await prisma.dailyRitual.create({
        data: {
          userId: req.user.id,
          date: today,
          message: generated.message,
          challenge: generated.challenge,
          challengeEmoji: generated.challengeEmoji || '✨',
        },
      });
    }

    const [streak, last7] = await Promise.all([
      calculateStreak(req.user.id),
      getLast7Days(req.user.id),
    ]);

    res.json({ ...ritual, streak, last7 });
  } catch (err) {
    console.error('Erro no ritual:', err);
    res.status(500).json({ error: 'Não foi possível carregar o ritual.' });
  }
});

// POST /ritual/complete — marca o desafio como concluído
router.post('/complete', authMiddleware, async (req, res) => {
  try {
    const today = todayStr();

    const ritual = await prisma.dailyRitual.upsert({
      where: { userId_date: { userId: req.user.id, date: today } },
      update: { completed: true, completedAt: new Date() },
      create: {
        userId: req.user.id,
        date: today,
        message: 'Ritual do dia',
        challenge: 'Desafio concluído',
        completed: true,
        completedAt: new Date(),
      },
    });

    const streak = await calculateStreak(req.user.id);
    res.json({ ...ritual, streak });
  } catch (err) {
    console.error('Erro ao completar ritual:', err);
    res.status(500).json({ error: 'Não foi possível registrar a conclusão.' });
  }
});

module.exports = router;
