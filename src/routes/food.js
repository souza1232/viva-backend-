const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware, subscriptionMiddleware } = require('../middleware/auth');
const { analyzeFoodImage } = require('../services/foodAnalysis');
const { generateMealPlan, generateRecipe } = require('../services/anthropic');

const router = express.Router();
const prisma = new PrismaClient();

const MAX_IMAGE_SIZE_MB = 5;
const MAX_IMAGE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;

// POST /ai/food — analisa foto de refeição
router.post('/', authMiddleware, subscriptionMiddleware, async (req, res) => {
  const { imageBase64, mediaType } = req.body;

  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return res.status(400).json({ error: 'Imagem não enviada.' });
  }

  // Validar tamanho da imagem (base64 ~= 4/3 do tamanho original)
  const estimatedBytes = Math.ceil(imageBase64.length * 0.75);
  if (estimatedBytes > MAX_IMAGE_BYTES) {
    return res.status(400).json({ error: `Imagem muito grande. Máximo ${MAX_IMAGE_SIZE_MB}MB.` });
  }

  const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const type = mediaType || 'image/jpeg';
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: 'Formato de imagem inválido. Use JPEG, PNG ou WebP.' });
  }

  try {
    const analysis = await analyzeFoodImage({
      imageBase64,
      mediaType: type,
      userName: req.user.name.split(' ')[0],
      userSymptoms: req.user.mainSymptoms || [],
    });

    // Salvar no banco
    const saved = await prisma.mealAnalysis.create({
      data: {
        userId: req.user.id,
        mealDescription: analysis.mealDescription || 'Refeição',
        calories: analysis.calories || null,
        isGoodForMeno: analysis.isGoodForMeno ?? true,
        benefits: analysis.benefits || [],
        warnings: analysis.warnings || [],
        suggestions: analysis.suggestions || [],
        fullAnalysis: analysis.fullAnalysis || '',
        mealType: analysis.mealType || null,
      },
    });

    res.json({
      id: saved.id,
      ...analysis,
      createdAt: saved.createdAt,
    });
  } catch (err) {
    console.error('Erro na análise de alimentos:', err);
    res.status(500).json({ error: 'Erro ao analisar a refeição. Tente novamente.' });
  }
});

// GET /ai/food/history — histórico de refeições
router.get('/history', authMiddleware, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = parseInt(req.query.offset) || 0;

  const [meals, total] = await Promise.all([
    prisma.mealAnalysis.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        mealDescription: true,
        calories: true,
        isGoodForMeno: true,
        mealType: true,
        benefits: true,
        warnings: true,
        suggestions: true,
        fullAnalysis: true,
        createdAt: true,
      },
    }),
    prisma.mealAnalysis.count({ where: { userId: req.user.id } }),
  ]);

  res.json({ meals, total });
});

// GET /ai/food/today — resumo de hoje
router.get('/today', authMiddleware, async (req, res) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const meals = await prisma.mealAnalysis.findMany({
    where: {
      userId: req.user.id,
      createdAt: { gte: start, lte: end },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      mealDescription: true,
      calories: true,
      isGoodForMeno: true,
      mealType: true,
      createdAt: true,
    },
  });

  const totalCalories = meals.reduce((sum, m) => sum + (m.calories || 0), 0);

  res.json({ meals, totalCalories, count: meals.length });
});

// GET /ai/food/meal-plan — cardápio mensal personalizado
router.get('/meal-plan', authMiddleware, async (req, res) => {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const refresh = req.query.refresh === 'true';

  try {
    if (refresh) {
      await prisma.mealPlan.deleteMany({ where: { userId: req.user.id, month, year } });
    }

    let plan = await prisma.mealPlan.findUnique({
      where: { userId_month_year: { userId: req.user.id, month, year } },
    });

    if (!plan) {
      const planData = await generateMealPlan(req.user);
      plan = await prisma.mealPlan.create({
        data: { userId: req.user.id, month, year, planData },
      });
    }

    res.json(plan.planData);
  } catch (err) {
    console.error('Erro ao gerar cardápio:', err);
    res.status(500).json({ error: 'Erro ao gerar cardápio. Tente novamente.' });
  }
});

// POST /ai/food/recipe — gera receita completa para um prato do cardápio
router.post('/recipe', authMiddleware, async (req, res) => {
  const { mealName, ingredients } = req.body;
  if (!mealName || !ingredients?.length) {
    return res.status(400).json({ error: 'Nome e ingredientes são obrigatórios.' });
  }
  try {
    const recipe = await generateRecipe({ mealName, ingredients });
    res.json(recipe);
  } catch (err) {
    console.error('Erro ao gerar receita:', err);
    res.status(500).json({ error: 'Erro ao gerar receita.' });
  }
});

module.exports = router;
