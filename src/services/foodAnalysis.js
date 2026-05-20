const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const FOOD_SYSTEM_PROMPT = `Você é Viva, assistente especializada em menopausa e nutrição feminina.
Analise a foto da refeição e responda em JSON com foco nas necessidades específicas de mulheres na menopausa.

Nutrientes críticos na menopausa que você deve sempre considerar:
- Cálcio e Vitamina D: saúde óssea (risco de osteoporose aumenta)
- Magnésio: reduz fogachos e melhora o sono
- Proteína: preserva massa muscular (reduz naturalmente após os 45)
- Ômega-3: inflamação, humor e saúde cardiovascular
- Fitoestrogênios (soja, linhaça, grão-de-bico): ajudam a equilibrar hormônios
- Fibras: controle de peso e intestino
- Ferro: cansaço e fadiga
- Antioxidantes: combate envelhecimento celular

Alimentos que pioram sintomas da menopausa:
- Açúcar refinado e ultraprocessados: piora fogachos e ganho de peso
- Álcool: piora fogachos, insônia e ansiedade
- Cafeína em excesso: insônia e fogachos
- Sódio em excesso: retenção de líquidos e pressão
- Gordura saturada: saúde cardiovascular

Seu tom: acolhedor, direto, sem culpa — como uma amiga nutricionista.`;

function detectMealType() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 10) return 'café da manhã';
  if (hour >= 10 && hour < 12) return 'lanche da manhã';
  if (hour >= 12 && hour < 15) return 'almoço';
  if (hour >= 15 && hour < 18) return 'lanche da tarde';
  if (hour >= 18 && hour < 22) return 'jantar';
  return 'lanche noturno';
}

async function analyzeFoodImage({ imageBase64, mediaType = 'image/jpeg', userName, userSymptoms = [] }) {
  const mealType = detectMealType();
  const symptomsContext = userSymptoms.length > 0
    ? `A usuária tem os seguintes sintomas: ${userSymptoms.join(', ')}.`
    : '';

  const prompt = `${userName} está fazendo seu ${mealType}. ${symptomsContext}

Analise esta foto de refeição e responda APENAS com um JSON válido neste formato exato:

{
  "mealDescription": "descrição simples e clara do que você vê no prato",
  "calories": 450,
  "isGoodForMeno": true,
  "mealType": "${mealType}",
  "benefits": ["benefício 1 específico para menopausa", "benefício 2"],
  "warnings": ["atenção 1 se houver algo que piora sintomas"],
  "suggestions": ["sugestão prática 1", "sugestão prática 2"],
  "nutrients": {
    "proteina": "alto/médio/baixo",
    "calcio": "alto/médio/baixo",
    "fibras": "alto/médio/baixo",
    "acucar": "alto/médio/baixo"
  },
  "fullAnalysis": "Resposta completa da Viva em tom acolhedor — 3 a 4 frases. Use o nome ${userName}. Mencione o ${mealType}. Fale sobre o que é bom para a menopausa neste prato. Termine com um encorajamento ou dica prática."
}

Se não conseguir identificar alimentos claramente, estime com base no que é visível.
Responda APENAS o JSON, sem texto adicional.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: FOOD_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
  });

  const raw = response.content[0].text.trim();

  // Remove markdown code blocks se presentes
  const cleaned = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '');

  try {
    return JSON.parse(cleaned);
  } catch {
    return {
      mealDescription: 'Refeição identificada',
      calories: null,
      isGoodForMeno: true,
      mealType,
      benefits: [],
      warnings: [],
      suggestions: [],
      nutrients: {},
      fullAnalysis: raw,
    };
  }
}

module.exports = { analyzeFoodImage };
