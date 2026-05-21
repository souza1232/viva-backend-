require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const aiRoutes = require('./routes/ai');
const foodRoutes = require('./routes/food');
const communityRoutes = require('./routes/community');
const reportRoutes = require('./routes/report');
const subscriptionRoutes = require('./routes/subscription');
const checkinRoutes = require('./routes/checkin');
const ritualRoutes = require('./routes/ritual');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = [
  'https://appviva.com.br',
  'https://www.appviva.com.br',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// Webhook do Stripe precisa do body raw
app.use('/subscription/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Muitas requisições. Tente novamente em 15 minutos.' },
});
app.use(limiter);

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Limite de mensagens por minuto atingido.' },
});

app.use('/auth', authRoutes);
app.use('/user', userRoutes);
app.use('/ai', aiLimiter, aiRoutes);
app.use('/ai/food', aiLimiter, foodRoutes);
app.use('/community', communityRoutes);
app.use('/user/report', reportRoutes);
app.use('/subscription', subscriptionRoutes);
app.use('/checkin', checkinRoutes);
app.use('/ritual', ritualRoutes);
app.use('/admin', adminRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', app: 'Viva API', version: '1.0.0' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

app.listen(PORT, () => {
  console.log(`🌸 Viva API rodando na porta ${PORT}`);
});

module.exports = app;
