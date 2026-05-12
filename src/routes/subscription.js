const express = require('express');
const { MercadoPagoConfig, PreApproval } = require('mercadopago');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

const mpClient = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const preApproval = new PreApproval(mpClient);

const TRIAL_DAYS = 7;

// POST /subscription/checkout — cria assinatura Mercado Pago
router.post('/checkout', authMiddleware, async (req, res) => {
  try {
    const { plan = 'monthly' } = req.body;
    const isYearly = plan === 'yearly';

    const response = await preApproval.create({
      body: {
        reason: isYearly ? 'Viva Pro — Anual' : 'Viva Pro — Mensal',
        auto_recurring: {
          frequency: isYearly ? 12 : 1,
          frequency_type: 'months',
          transaction_amount: isYearly ? 297.00 : 37.90,
          currency_id: 'BRL',
        },
        back_url: process.env.FRONTEND_URL || 'https://appviva.com.br',
        payer_email: req.user.email,
        status: 'pending',
        external_reference: req.user.id,
      },
    });

    res.json({ url: response.init_point, id: response.id });
  } catch (err) {
    console.error('Erro no checkout MP:', err);
    res.status(500).json({ error: 'Erro ao criar assinatura.' });
  }
});

// GET /subscription/status — status atual
router.get('/status', authMiddleware, async (req, res) => {
  let sub = await prisma.subscription.findUnique({ where: { userId: req.user.id } });

  if (!sub) {
    sub = await prisma.subscription.create({
      data: {
        userId: req.user.id,
        status: 'trial',
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
      },
    });
  }

  const now = new Date();
  const isTrialValid = sub.status === 'trial' && sub.trialEndsAt && sub.trialEndsAt > now;
  const isActive = sub.status === 'active' && sub.currentPeriodEnd && sub.currentPeriodEnd > now;

  res.json({
    status: sub.status,
    isValid: isTrialValid || isActive,
    trialEndsAt: sub.trialEndsAt,
    currentPeriodEnd: sub.currentPeriodEnd,
  });
});

// POST /subscription/webhook — notificações do Mercado Pago
router.post('/webhook', async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type === 'subscription_preapproval' && data?.id) {
      const mpSub = await preApproval.get({ id: data.id });
      const userId = mpSub.external_reference;
      if (!userId) return res.json({ received: true });

      const status = mpSub.status === 'authorized' ? 'active' : mpSub.status;
      const nextPayment = mpSub.summarized?.next_charge_date
        ? new Date(mpSub.summarized.next_charge_date)
        : null;

      await prisma.subscription.upsert({
        where: { userId },
        create: { userId, mpSubscriptionId: data.id, status, currentPeriodEnd: nextPayment },
        update: { mpSubscriptionId: data.id, status, currentPeriodEnd: nextPayment },
      });
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook MP erro:', err);
    res.status(500).json({ error: 'Erro no webhook' });
  }
});

// POST /subscription/cancel — cancela assinatura
router.post('/cancel', authMiddleware, async (req, res) => {
  try {
    const sub = await prisma.subscription.findUnique({ where: { userId: req.user.id } });
    if (sub?.mpSubscriptionId) {
      await preApproval.update({
        id: sub.mpSubscriptionId,
        body: { status: 'cancelled' },
      });
    }
    await prisma.subscription.update({
      where: { userId: req.user.id },
      data: { status: 'canceled' },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao cancelar:', err);
    res.status(500).json({ error: 'Erro ao cancelar assinatura.' });
  }
});

module.exports = router;
