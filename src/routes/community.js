const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { z } = require('zod');
const { authMiddleware, subscriptionMiddleware } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Temas rotativos por semana do mês
const WEEK_THEMES = {
  1: 'corpo',
  2: 'mente',
  3: 'vida_pratica',
  4: 'reinvencao',
};

function getCurrentWeekTheme() {
  const now = new Date();
  const weekOfMonth = Math.ceil(now.getDate() / 7);
  return WEEK_THEMES[Math.min(weekOfMonth, 4)] || 'corpo';
}

function getWeekYear(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// GET /community/posts — lista posts da semana atual
router.get('/posts', authMiddleware, subscriptionMiddleware, async (req, res) => {
  const weekYear = req.query.week || getWeekYear();
  const theme = req.query.theme;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = parseInt(req.query.offset) || 0;

  const where = { weekYear };
  if (theme) where.theme = theme;

  const [posts, total] = await Promise.all([
    prisma.communityPost.findMany({
      where,
      include: {
        user: { select: { id: true, name: true } },
        replies: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { replies: true } },
      },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      skip: offset,
    }),
    prisma.communityPost.count({ where }),
  ]);

  res.json({
    posts,
    total,
    currentTheme: getCurrentWeekTheme(),
    weekYear,
  });
});

// POST /community/posts — cria novo post
router.post('/posts', authMiddleware, subscriptionMiddleware, async (req, res) => {
  const schema = z.object({
    content: z.string().min(10, 'Post muito curto').max(2000, 'Post muito longo'),
    theme: z.enum(['corpo', 'mente', 'vida_pratica', 'reinvencao']).optional(),
  });

  try {
    const { content, theme } = schema.parse(req.body);
    const post = await prisma.communityPost.create({
      data: {
        userId: req.user.id,
        content,
        theme: theme || getCurrentWeekTheme(),
        weekYear: getWeekYear(),
      },
      include: {
        user: { select: { id: true, name: true } },
        _count: { select: { replies: true } },
      },
    });
    res.status(201).json(post);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors[0].message });
    }
    res.status(500).json({ error: 'Erro ao criar post.' });
  }
});

// POST /community/posts/:id/reply — responde um post
router.post('/posts/:id/reply', authMiddleware, subscriptionMiddleware, async (req, res) => {
  const schema = z.object({
    content: z.string().min(2, 'Resposta muito curta').max(1000, 'Resposta muito longa'),
  });

  try {
    const { content } = schema.parse(req.body);
    const post = await prisma.communityPost.findUnique({ where: { id: req.params.id } });
    if (!post) {
      return res.status(404).json({ error: 'Post não encontrado.' });
    }

    const reply = await prisma.communityReply.create({
      data: {
        postId: req.params.id,
        userId: req.user.id,
        content,
      },
      include: { user: { select: { id: true, name: true } } },
    });
    res.status(201).json(reply);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors[0].message });
    }
    res.status(500).json({ error: 'Erro ao criar resposta.' });
  }
});

// DELETE /community/posts/:id — remove post próprio
router.delete('/posts/:id', authMiddleware, async (req, res) => {
  const post = await prisma.communityPost.findUnique({ where: { id: req.params.id } });
  if (!post) return res.status(404).json({ error: 'Post não encontrado.' });
  if (post.userId !== req.user.id) {
    return res.status(403).json({ error: 'Sem permissão para remover este post.' });
  }

  await prisma.communityPost.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

module.exports = router;
