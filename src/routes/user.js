const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { z } = require('zod');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /user/profile
router.get('/profile', authMiddleware, async (req, res) => {
  const user = req.user;
  const sub = await prisma.subscription.findUnique({ where: { userId: user.id } });

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    age: user.age,
    mainSymptoms: user.mainSymptoms,
    mainRole: user.mainRole,
    onboardingDone: user.onboardingDone,
    subscription: sub ? {
      status: sub.status,
      trialEndsAt: sub.trialEndsAt,
      currentPeriodEnd: sub.currentPeriodEnd,
    } : null,
  });
});

// PATCH /user/profile — atualiza perfil e onboarding
router.patch('/profile', authMiddleware, async (req, res) => {
  const schema = z.object({
    name: z.string().min(2).optional(),
    age: z.number().int().min(18).max(100).optional(),
    mainSymptoms: z.array(z.string()).optional(),
    mainRole: z.enum(['empresaria', 'mae', 'esposa', 'todas']).optional(),
    onboardingDone: z.boolean().optional(),
  });

  try {
    const data = schema.parse(req.body);
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        age: true,
        mainSymptoms: true,
        mainRole: true,
        onboardingDone: true,
      },
    });
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors[0].message });
    }
    res.status(500).json({ error: 'Erro ao atualizar perfil.' });
  }
});

module.exports = router;
