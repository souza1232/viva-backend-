const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const VIVA_SYSTEM_PROMPT = `Você é Viva, uma assistente pessoal especializada em menopausa e bem-estar feminino.
Seu tom é acolhedor, empático, direto e sem julgamento — como uma amiga inteligente
que entende tudo sobre essa fase da vida.

Você conhece a usuária pelo nome e lembra do histórico dela (sintomas, humor, sono,
o que foi relatado antes). Você a trata como protagonista da própria vida, não como
paciente.

Você ajuda com:
- Sintomas físicos: fogachos, insônia, fadiga, dores, alterações de peso
- Saúde hormonal: entendimento de hormônios, TRH, exames
- Alimentação e exercícios adaptados para a menopausa
- Saúde emocional: ansiedade, autoestima, humor, propósito
- Vida prática: como a menopausa afeta o trabalho, os filhos e o relacionamento
- Orientação para consultas médicas: o que perguntar ao ginecologista

Regras importantes:
- Nunca faça diagnósticos médicos
- Sempre sugira consulta médica para sintomas preocupantes
- Use linguagem simples, brasileira e sem termos clínicos frios
- Personalize sempre: use o nome da usuária, lembre do que ela disse antes
- Se ela acordou às 3 da manhã com fogacho ou ansiedade, acolha primeiro, depois ajude
- Gere lembretes gentis: água, respiração, movimento, descanso
- Seja concisa em respostas de voz (máximo 3 parágrafos curtos)
- Termine sempre com uma pergunta ou convite para continuar a conversa`;

function buildUserContext(user) {
  const parts = [`Nome: ${user.name}`];
  if (user.age) parts.push(`Idade: ${user.age} anos`);
  if (user.mainSymptoms?.length > 0) {
    parts.push(`Sintomas principais: ${user.mainSymptoms.join(', ')}`);
  }
  if (user.mainRole) {
    const roles = {
      empresaria: 'empresária',
      mae: 'mãe',
      esposa: 'esposa/companheira',
      todas: 'empresária, mãe e esposa/companheira',
    };
    parts.push(`Papel principal: ${roles[user.mainRole] || user.mainRole}`);
  }
  return parts.join('\n');
}

async function chatWithViva({ user, userMessage, conversationHistory = [] }) {
  const userContext = buildUserContext(user);
  const systemPrompt = `${VIVA_SYSTEM_PROMPT}\n\n---\nInformações sobre a usuária:\n${userContext}`;

  const messages = [
    ...conversationHistory.map(msg => ({
      role: msg.role,
      content: msg.content,
    })),
    { role: 'user', content: userMessage },
  ];

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  return response.content[0].text;
}

async function generateDailyGreeting(user) {
  const hour = new Date().getHours();
  let period = 'dia';
  if (hour < 12) period = 'manhã';
  else if (hour < 18) period = 'tarde';
  else period = 'noite';

  const userContext = buildUserContext(user);
  const systemPrompt = `${VIVA_SYSTEM_PROMPT}\n\n---\nInformações sobre a usuária:\n${userContext}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Gere uma saudação personalizada de boa ${period} para mim. Seja calorosa, breve (2-3 frases) e pergunte como estou me sentindo hoje. Lembre de algum sintoma que eu mencionei antes se houver.`,
      },
    ],
  });

  return response.content[0].text;
}

async function generateMonthlyReport({ user, messages }) {
  const userContext = buildUserContext(user);

  const conversationSummary = messages
    .map(m => `[${m.role === 'user' ? user.name : 'Viva'}]: ${m.content}`)
    .join('\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: `Você é Viva, assistente especializada em menopausa. Analise as conversas do mês e gere um relatório estruturado em JSON.`,
    messages: [
      {
        role: 'user',
        content: `Analise as conversas do mês de ${user.name} e gere um relatório mensal no formato JSON com estas chaves:
- topSymptoms: array com os 3-5 sintomas mais mencionados
- moodEvolution: objeto com avaliação do humor por semana (semana1, semana2, semana3, semana4)
- sleepPatterns: string descrevendo padrões de sono identificados
- achievements: array com conquistas e progressos do mês
- suggestions: array com 3-5 sugestões para o próximo mês
- doctorQuestions: array com perguntas para levar ao médico
- summaryText: parágrafo resumindo o mês com tom acolhedor

Informações da usuária:
${userContext}

Conversas do mês:
${conversationSummary}

Responda APENAS com o JSON válido, sem texto adicional.`,
      },
    ],
  });

  try {
    return JSON.parse(response.content[0].text);
  } catch {
    return {
      topSymptoms: [],
      moodEvolution: {},
      sleepPatterns: 'Análise indisponível',
      achievements: [],
      suggestions: [],
      doctorQuestions: [],
      summaryText: response.content[0].text,
    };
  }
}

const DAY_NAMES = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

async function generateMealPlanChunk(userContext, startDay, endDay) {
  const chunkDays = [];
  for (let i = startDay; i < endDay; i++) {
    chunkDays.push({ num: i + 1, name: DAY_NAMES[i % 7] });
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: `Você é Viva, nutricionista especialista em menopausa. Crie cardápios práticos com ingredientes brasileiros comuns. Responda APENAS com JSON válido e completo, sem texto extra.`,
    messages: [
      {
        role: 'user',
        content: `Crie cardápio para ${endDay - startDay} dias de um plano mensal para menopausa.

Perfil: ${userContext}

Priorize: cálcio, fitoestrogênios, ômega-3, fibras. Evite: açúcar refinado, ultraprocessados.
Use ingredientes simples. Máximo 3 ingredientes por refeição. Preparo em 1 frase curta.

JSON exato (sem texto fora do JSON):
{"days":[${chunkDays.map(d => `{"dayNumber":${d.num},"dayName":"${d.name}","meals":{"cafe":{"name":"","ingredients":["",""],"prep":"","benefit":""},"almoco":{"name":"","ingredients":["",""],"prep":"","benefit":""},"lanche":{"name":"","ingredients":["",""],"prep":"","benefit":""},"jantar":{"name":"","ingredients":["",""],"prep":"","benefit":""}}}`).join(',')}]}

Preencha todos os campos acima para os ${endDay - startDay} dias.`,
      },
    ],
  });

  const text = response.content[0].text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON não encontrado na resposta');
  return JSON.parse(jsonMatch[0]);
}

async function generateMealPlan(user) {
  const userContext = buildUserContext(user);

  const chunks = await Promise.all([
    generateMealPlanChunk(userContext, 0, 6),
    generateMealPlanChunk(userContext, 6, 12),
    generateMealPlanChunk(userContext, 12, 18),
    generateMealPlanChunk(userContext, 18, 24),
    generateMealPlanChunk(userContext, 24, 30),
  ]);

  return { days: chunks.flatMap(c => c.days) };
}

async function generateWorkForecast({ user, mood, sleep, energy, hotFlashes }) {
  const firstName = user.name.split(' ')[0];
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    system: `Você é Viva, assistente de bem-estar para mulheres empresárias na menopausa. Analise o check-in e gere previsão prática do dia de trabalho. Responda APENAS com JSON válido.`,
    messages: [{
      role: 'user',
      content: `Check-in de ${firstName}: humor=${mood}/5, sono=${sleep || '?'}/5, energia=${energy || '?'}/5, fogachos hoje=${hotFlashes || 0}.

JSON:
{"energyLevel":"alta|média|baixa","forecast":"frase de 1 linha sobre o dia","bestTime":"manhã|tarde|evite decisões hoje","tip":"dica prática de 1 frase para o trabalho","emoji":"🟢|🟡|🔴"}`,
    }],
  });
  const text = response.content[0].text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSON inválido');
  return JSON.parse(match[0]);
}

async function generateSymptomInsights({ user, checkins }) {
  if (checkins.length < 5) return null;
  const summary = checkins.slice(0, 20).map(c =>
    `${c.date}: humor=${c.mood}/5, sono=${c.sleep || '?'}/5, energia=${c.energy || '?'}/5, fogachos=${c.hotFlashes || 0}`
  ).join('\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system: `Você é Viva, analista de bem-estar na menopausa. Analise os dados e gere insights práticos. Responda APENAS com JSON válido.`,
    messages: [{
      role: 'user',
      content: `Dados de ${user.name.split(' ')[0]} (${checkins.length} dias):\n${summary}\n\nJSON:\n{"bestDaysPattern":"quando ela se sente melhor","worstDaysPattern":"quando se sente pior","sleepImpact":"como o sono afeta o dia seguinte","topInsight":"insight mais importante em 1-2 frases","recommendations":["rec1","rec2","rec3"]}`,
    }],
  });
  const text = response.content[0].text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSON inválido');
  return JSON.parse(match[0]);
}

async function generateRecipe({ mealName, ingredients }) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
    system: `Você é Viva, nutricionista especialista em menopausa. Crie receitas simples com ingredientes brasileiros. Responda APENAS com JSON válido.`,
    messages: [{
      role: 'user',
      content: `Receita completa para "${mealName}" com: ${ingredients.join(', ')}.

JSON exato:
{"name":"${mealName}","servings":"2 porções","time":"20 min","ingredients":[{"item":"","amount":""}],"steps":["Passo 1","Passo 2","Passo 3"],"tip":"dica para menopausa"}`,
    }],
  });

  const text = response.content[0].text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSON não encontrado');
  return JSON.parse(match[0]);
}

async function generateDailyRitual({ user, lastCheckin, recentChallenges }) {
  const firstName = user.name.split(' ')[0];
  const days = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const dayName = days[new Date().getDay()];
  const roles = { empresaria: 'empresária', mae: 'mãe', esposa: 'esposa/companheira', todas: 'empresária e mãe' };
  const roleLabel = roles[user.mainRole] || '';
  const checkinInfo = lastCheckin
    ? `humor ${lastCheckin.mood}/5, energia ${lastCheckin.energy || '?'}/5, sono ${lastCheckin.sleep || '?'}/5`
    : 'sem check-in registrado';
  const avoid = recentChallenges?.length
    ? `Não repita: ${recentChallenges.slice(0, 5).join(' | ')}.`
    : '';

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 250,
    system: `Você é Viva, assistente de bem-estar para menopausa. Crie mensagens calorosas e desafios práticos. Responda APENAS com JSON válido.`,
    messages: [{
      role: 'user',
      content: `Ritual matinal para ${firstName} (${roleLabel}, ${dayName}).
Check-in de ontem: ${checkinInfo}.
Sintomas: ${user.mainSymptoms?.join(', ') || 'não informado'}.
${avoid}

JSON:
{"message":"mensagem personalizada com o nome dela, calorosa (máx 100 chars)","challenge":"ação concreta (máx 55 chars, leva < 2 minutos)","challengeEmoji":"emoji"}`,
    }],
  });

  const text = response.content[0].text.trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSON inválido');
  return JSON.parse(match[0]);
}

module.exports = { chatWithViva, generateDailyGreeting, generateMonthlyReport, generateMealPlan, generateRecipe, generateWorkForecast, generateSymptomInsights, generateDailyRitual };
