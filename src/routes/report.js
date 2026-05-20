const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware, subscriptionMiddleware } = require('../middleware/auth');
const { generateMonthlyReport } = require('../services/anthropic');

const router = express.Router();
const prisma = new PrismaClient();

// GET /user/report — relatório do mês atual (ou ?month=X&year=Y)
router.get('/', authMiddleware, subscriptionMiddleware, async (req, res) => {
  const now = new Date();
  const month = parseInt(req.query.month) || now.getMonth() + 1;
  const year = parseInt(req.query.year) || now.getFullYear();

  const existing = await prisma.monthlyReport.findUnique({
    where: { userId_month_year: { userId: req.user.id, month, year } },
  });

  if (existing) {
    return res.json(existing);
  }

  // Gerar novo relatório
  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59);

  const messages = await prisma.message.findMany({
    where: {
      userId: req.user.id,
      createdAt: { gte: startOfMonth, lte: endOfMonth },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (messages.length < 5) {
    return res.status(404).json({
      error: 'Poucas conversas este mês para gerar um relatório. Continue conversando com a Viva!',
    });
  }

  try {
    const reportData = await generateMonthlyReport({ user: req.user, messages });

    const report = await prisma.monthlyReport.create({
      data: {
        userId: req.user.id,
        month,
        year,
        topSymptoms: reportData.topSymptoms || [],
        moodEvolution: reportData.moodEvolution || {},
        sleepPatterns: reportData.sleepPatterns || '',
        achievements: reportData.achievements || [],
        suggestions: reportData.suggestions || [],
        doctorQuestions: reportData.doctorQuestions || [],
        summaryText: reportData.summaryText || '',
      },
    });

    res.json(report);
  } catch (err) {
    console.error('Erro ao gerar relatório:', err);
    res.status(500).json({ error: 'Erro ao gerar relatório mensal.' });
  }
});

// GET /user/report/list — lista todos os relatórios da usuária
router.get('/list', authMiddleware, async (req, res) => {
  const reports = await prisma.monthlyReport.findMany({
    where: { userId: req.user.id },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    select: { id: true, month: true, year: true, summaryText: true, createdAt: true },
  });
  res.json({ reports });
});

module.exports = router;
