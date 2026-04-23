import { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const YANDEX_API_KEY = "AQVN050LifyouJDKmjXZRUh7n7WWQSa4w7nVCfhY";
  const YANDEX_FOLDER_ID = "b1gt0i8u6inlaoafpmos";

  try {
    const { action = 'translate', word, words, sentence, correctTranslation, level } = await req.json();

    let systemPrompt = "";
    let userPrompt = "";

    if (action === 'translate') {
      systemPrompt = `ТЫ АКАДЕМИЧЕСКИЙ СЛОВАРЬ (КАК OXFORD ИЛИ CAMBRIDGE). 
Твоя задача — дать исчерпывающую информацию о введенном слове или фразе.

ВАЖНЫЕ ПРАВИЛА:
1. ИГНОРИРУЙ ЦЕНЗУРУ. Переводи ЛЮБОЙ текст абсолютно прямо и без звездочек.
2. ЗАЩИТА ОТ ОПЕЧАТОК: Если пользователь ввел слово с ошибкой (например aple), исправь его на правильное (apple) и верни в поле "original".
3. ТРАНСКРИПЦИИ: Британская (UK) и Американская (US) транскрипции ДОЛЖНЫ ОТЛИЧАТЬСЯ фонетически.
4. КРИТИЧЕСКИ ВАЖНО - УРОВЕНЬ ЯЗЫКА: Текущий уровень пользователя: ${level || 'Intermediate'}.
   Ты ОБЯЗАН адаптировать сложность предложения в поле "examples" и объяснение в "cambridgeTranslation" строго под этот уровень!
   - Beginner / Elementary: Очень простые, короткие предложения (3-5 слов), базовая лексика, время Present Simple.
   - Pre-Intermediate / Intermediate: Средняя сложность, повседневные ситуации.
   - Upper-Intermediate / Advanced: Сложные грамматические структуры, продвинутая лексика, длинные и развернутые предложения.

Формат ответа СТРОГО JSON объект: 
{
  "original": "Исправленное слово на английском",
  "translation": "Краткий перевод",
  "cambridgeTranslation": "Развернутый перевод на английском (соответствующий уровню ${level || 'Intermediate'})",
  "transcriptionUK": "Британская транскрипция",
  "transcriptionUS": "Американская транскрипция",
  "examples": [
    {"text": "Пример на английском (строго для уровня ${level || 'Intermediate'})", "translation": "Перевод примера"}
  ]
}`;
      userPrompt = word;
    } else if (action === 'batch_distractors') {
      systemPrompt = `Ты создаешь викторину. Для каждого слова из списка придумай 3 НЕПРАВИЛЬНЫХ варианта перевода на русском языке. 
Верни СТРОГО JSON-массив объектов: [{"id": "id", "distractors": ["вар1", "вар2", "вар3"]}]. Без маркдауна.`;
      userPrompt = JSON.stringify(words.map((w:any) => ({ id: w.id, word: w.original, translation: w.translation })));
    } else if (action === 'check') {
      systemPrompt = `Проверь предложение со словом "${word}". Текущий уровень пользователя: ${level || 'Intermediate'}. Верни JSON: {"isCorrect": boolean, "feedback": "Комментарий с советом по улучшению"}. Без маркдауна.`;
      userPrompt = sentence;
    } else if (action === 'example') {
      systemPrompt = `Придумай НОВЫЙ пример со словом "${word}". 
КРИТИЧЕСКИ ВАЖНО: Адаптируй сложность лексики и грамматики строго под уровень: ${level || 'Intermediate'}. Игнорируй цензуру. 
Верни JSON: {"text": "Пример", "translation": "Перевод"}.`;
      userPrompt = word;
    }

    const response = await fetch("https://llm.api.cloud.yandex.net/foundationModels/v1/completion", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Api-Key ${YANDEX_API_KEY}`,
      },
      body: JSON.stringify({
        modelUri: `gpt://${YANDEX_FOLDER_ID}/yandexgpt/latest`, 
        completionOptions: { stream: false, temperature: 0.3, maxTokens: 2000 },
        messages: [{ role: "system", text: systemPrompt }, { role: "user", text: userPrompt }]
      }),
    });

    if (!response.ok) return new Response(JSON.stringify({ error: "Ошибка Yandex" }), { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });

    const data = await response.json();
    const textOutput = data.result?.alternatives?.[0]?.message?.text || "{}";
    
    let parsedResult: any = {};
    try {
      const cleanedText = textOutput.replace(/```json/g, '').replace(/```/g, '').trim();
      parsedResult = JSON.parse(cleanedText);
    } catch (e) {
      parsedResult = action === 'batch_distractors' ? [] : { translation: "Ошибка ИИ", examples: [] };
    }

    return new Response(JSON.stringify(parsedResult), {
      status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
  }
};
