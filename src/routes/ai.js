const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware, subscriptionMiddleware } = require('../middleware/auth');
const { chatWithViva, generateDailyGreeting, generateWorkForecast, generateSymptomInsights } = require('../services/anthropic');
const { textToSpeech } = require('../services/elevenlabs');

const router = express.Router();
const prisma = new PrismaClient();

const CHAT_LIMIT = 20;
const WINDOW_MS = 3 * 60 * 60 * 1000; // 3 horas

async function getChatUsage(userId) {
  const windowStart = new Date(Date.now() - WINDOW_MS);
  const used = await prisma.message.count({
    where: { userId, role: 'user', createdAt: { gte: windowStart } },
  });

  let resetAt = null;
  if (used >= CHAT_LIMIT) {
    const oldest = await prisma.message.findFirst({
      where: { userId, role: 'user', createdAt: { gte: windowStart } },
      orderBy: { createdAt: 'asc' },
    });
    if (oldest) resetAt = new Date(oldest.createdAt.getTime() + WINDOW_MS);
  }

  return { used, limit: CHAT_LIMIT, resetAt, canSend: used < CHAT_LIMIT };
}

// Busca as últimas N mensagens para contexto
async function getConversationHistory(userId, limit = 20) {
  const messages = await prisma.message.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return messages.reverse().map(m => ({ role: m.role, content: m.content }));
}

// GET /ai/usage — uso atual do chat
router.get('/usage', authMiddleware, async (req, res) => {
  try {
    const usage = await getChatUsage(req.user.id);
    res.json(usage);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar uso.' });
  }
});

// POST /ai/chat — envia mensagem e recebe resposta da IA
router.post('/chat', authMiddleware, subscriptionMiddleware, async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'Mensagem inválida.' });
  }

  // Verifica limite de mensagens (20 por janela de 3h)
  const usage = await getChatUsage(req.user.id);
  if (!usage.canSend) {
    return res.status(429).json({
      error: 'limit_reached',
      resetAt: usage.resetAt,
      used: usage.used,
      limit: usage.limit,
    });
  }

  try {
    const history = await getConversationHistory(req.user.id);
    const aiResponse = await chatWithViva({
      user: req.user,
      userMessage: message.trim(),
      conversationHistory: history,
    });

    // Salva as duas mensagens
    await prisma.message.createMany({
      data: [
        { userId: req.user.id, role: 'user', content: message.trim() },
        { userId: req.user.id, role: 'assistant', content: aiResponse },
      ],
    });

    const newUsed = usage.used + 1;
    res.json({ message: aiResponse, used: newUsed, limit: CHAT_LIMIT });
  } catch (err) {
    console.error('Erro no chat:', err);
    res.status(500).json({ error: 'Erro ao processar mensagem.' });
  }
});

// POST /ai/voice — converte texto em áudio
router.post('/voice', authMiddleware, subscriptionMiddleware, async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Texto inválido.' });
  }

  try {
    const audioBuffer = await textToSpeech(text);
    res.set('Content-Type', 'audio/mpeg');
    res.set('Content-Length', audioBuffer.length);
    res.send(audioBuffer);
  } catch (err) {
    console.error('Erro na síntese de voz:', err);
    res.status(500).json({ error: 'Erro ao gerar áudio.' });
  }
});

// GET /ai/greeting — saudação personalizada do dia
router.get('/greeting', authMiddleware, subscriptionMiddleware, async (req, res) => {
  try {
    const greeting = await generateDailyGreeting(req.user);
    res.json({ greeting });
  } catch (err) {
    console.error('Erro ao gerar saudação:', err);
    res.status(500).json({ error: 'Erro ao gerar saudação.' });
  }
});

// GET /ai/history — histórico de mensagens
router.get('/history', authMiddleware, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = parseInt(req.query.offset) || 0;

  const messages = await prisma.message.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });

  res.json({ messages: messages.reverse() });
});

// POST /ai/forecast — previsão do dia de trabalho com base no check-in
router.post('/forecast', authMiddleware, async (req, res) => {
  const { mood, sleep, energy, hotFlashes } = req.body;
  if (!mood) return res.status(400).json({ error: 'mood é obrigatório.' });
  try {
    const forecast = await generateWorkForecast({ user: req.user, mood, sleep, energy, hotFlashes });
    res.json(forecast);
  } catch (err) {
    console.error('Erro no forecast:', err);
    res.status(500).json({ error: 'Erro ao gerar previsão.' });
  }
});

// GET /ai/insights — insights de sintomas dos últimos 30 dias
router.get('/insights', authMiddleware, async (req, res) => {
  try {
    const checkins = await prisma.dailyCheckin.findMany({
      where: { userId: req.user.id },
      orderBy: { date: 'desc' },
      take: 30,
    });
    if (checkins.length < 5) {
      return res.json(null);
    }
    const insights = await generateSymptomInsights({ user: req.user, checkins });
    res.json(insights);
  } catch (err) {
    console.error('Erro nos insights:', err);
    res.status(500).json({ error: 'Erro ao gerar insights.' });
  }
});

module.exports = router;
