const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { z } = require('zod');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// POST /checkin — salva ou atualiza o check-in do dia
router.post('/', authMiddleware, async (req, res) => {
  const schema = z.object({
    mood: z.number().int().min(1).max(5),
    energy: z.number().int().min(1).max(5).optional(),
    sleep: z.number().int().min(1).max(5).optional(),
    hotFlashes: z.number().int().min(0).max(20).optional(),
    painLevel: z.number().int().min(1).max(5).optional(),
    notes: z.string().max(500).optional(),
  });

  try {
    const data = schema.parse(req.body);
    const today = new Date().toISOString().split('T')[0];

    const checkin = await prisma.dailyCheckin.upsert({
      where: { userId_date: { userId: req.user.id, date: today } },
      update: data,
      create: { userId: req.user.id, date: today, ...data },
    });

    res.json(checkin);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors[0].message });
    }
    console.error('Erro no check-in:', err);
    res.status(500).json({ error: 'Erro ao salvar check-in.' });
  }
});

// GET /checkin/today
router.get('/today', authMiddleware, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const checkin = await prisma.dailyCheckin.findUnique({
    where: { userId_date: { userId: req.user.id, date: today } },
  });
  res.json(checkin || null);
});

// GET /checkin — últimos N dias
router.get('/', authMiddleware, async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 90);
  const since = new Date();
  since.setDate(since.getDate() - days);

  const checkins = await prisma.dailyCheckin.findMany({
    where: {
      userId: req.user.id,
      date: { gte: since.toISOString().split('T')[0] },
    },
    orderBy: { date: 'desc' },
  });

  res.json(checkins);
});

module.exports = router;
