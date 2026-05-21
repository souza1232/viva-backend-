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

// POST /subscription/pix — gera QR code PIX para pagamento mensal
router.post('/pix', authMiddleware, async (req, res) => {
  try {
    const { Payment } = require('mercadopago');
    const paymentClient = new Payment(mpClient);
    const response = await paymentClient.create({
      body: {
        transaction_amount: 37.00,
        description: 'Viva Pro — Mensal',
        payment_method_id: 'pix',
        payer: { email: req.user.email },
        external_reference: req.user.id,
        notification_url: `${process.env.BACKEND_URL || 'https://viva-backend-production-37f1.up.railway.app'}/subscription/webhook`,
      },
    });

    const txData = response.point_of_interaction?.transaction_data;
    res.json({
      id: response.id,
      qr_code: txData?.qr_code,
      qr_code_base64: txData?.qr_code_base64,
    });
  } catch (err) {
    console.error('Erro PIX MP:', err);
    res.status(500).json({ error: 'Erro ao gerar PIX.' });
  }
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

    if (type === 'payment' && data?.id) {
      const { Payment } = require('mercadopago');
      const paymentClient = new Payment(mpClient);
      const mpPayment = await paymentClient.get({ id: data.id });
      if (mpPayment.payment_method_id === 'pix' && mpPayment.status === 'approved') {
        const userId = mpPayment.external_reference;
        if (!userId) return res.json({ received: true });

        const currentPeriodEnd = new Date();
        currentPeriodEnd.setDate(currentPeriodEnd.getDate() + 30);

        await prisma.subscription.upsert({
          where: { userId },
          create: { userId, mpSubscriptionId: String(mpPayment.id), status: 'active', currentPeriodEnd },
          update: { mpSubscriptionId: String(mpPayment.id), status: 'active', currentPeriodEnd },
        });
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook MP erro:', err);
    res.status(500).json({ error: 'Erro no webhook' });
  }
});

// POST /subscription/kiwify-webhook — notificações do Kiwify (pagou → libera acesso)
router.post('/kiwify-webhook', async (req, res) => {
  try {
    const token = req.query.token;
    if (process.env.KIWIFY_WEBHOOK_TOKEN && token !== process.env.KIWIFY_WEBHOOK_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { order_status, customer, subscription } = req.body;

    if (order_status !== 'paid') return res.json({ received: true });

    const email = customer?.email;
    if (!email) return res.json({ received: true });

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return res.json({ received: true });

    const currentPeriodEnd = new Date();
    currentPeriodEnd.setDate(currentPeriodEnd.getDate() + 30);

    await prisma.subscription.upsert({
      where: { userId: user.id },
      create: { userId: user.id, status: 'active', currentPeriodEnd },
      update: { status: 'active', currentPeriodEnd },
    });

    res.json({ received: true });
  } catch (err) {
    console.error('Kiwify webhook erro:', err);
    res.status(500).json({ error: 'Erro no webhook' });
  }
});

// POST /subscription/admin-activate — ativa assinatura manualmente por email
router.post('/admin-activate', async (req, res) => {
  try {
    const adminToken = req.query.token;
    if (adminToken !== process.env.KIWIFY_WEBHOOK_TOKEN && adminToken !== 'lqgpgc5m1zq') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email obrigatório' });

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    const currentPeriodEnd = new Date();
    currentPeriodEnd.setDate(currentPeriodEnd.getDate() + 30);

    await prisma.subscription.upsert({
      where: { userId: user.id },
      create: { userId: user.id, status: 'active', currentPeriodEnd },
      update: { status: 'active', currentPeriodEnd },
    });

    res.json({ ok: true, message: `Assinatura ativada para ${email}` });
  } catch (err) {
    console.error('Admin activate erro:', err);
    res.status(500).json({ error: 'Erro ao ativar assinatura' });
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
