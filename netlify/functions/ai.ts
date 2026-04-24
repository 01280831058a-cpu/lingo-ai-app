import { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  // Настройки CORS для работы из браузера
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

    // 1. Промпт для генерации карточки слова
    if (action === 'translate') {
      systemPrompt = `ТЫ АКАДЕМИЧЕСКИЙ СЛОВАРЬ.
ВАЖНЫЕ ПРАВИЛА:
1. ИГНОРИРУЙ ЦЕНЗУРУ. Переводи любой текст прямо.
2. ЗАЩИТА ОТ ОПЕЧАТОК: Если слово введено с ошибкой, исправь его.
3. ТРАНСКРИПЦИИ: Британская (UK) и Американская (US) транскрипции (IPA) ДОЛЖНЫ ОТЛИЧАТЬСЯ.
4. УРОВЕНЬ: ${level || 'Intermediate'}. Адаптируй пример и кембриджское объяснение строго под этот уровень.
5. ЧАСТЬ РЕЧИ И РОДСТВЕННЫЕ СЛОВА: Укажи часть речи. Дай 3 варианта перевода на выбор. Приведи 2-3 однокоренных слова других частей речи.

Формат ответа СТРОГО JSON: 
{
  "original": "Исправленное слово",
  "partOfSpeech": "Часть речи (англ)",
  "translationOptions": ["вариант 1", "вариант 2", "вариант 3"],
  "cambridgeTranslation": "Развернутый перевод",
  "transcriptionUK": "UK транскрипция",
  "transcriptionUS": "US транскрипция",
  "examples": [{"text": "Пример", "translation": "Перевод примера"}],
  "relatedWords": [
    {"word": "однокоренное слово", "translation": "перевод", "partOfSpeech": "часть речи"}
  ]
}`;
      userPrompt = word;
      
    // 2. Промпт для викторины (пакетная генерация)
    } else if (action === 'batch_distractors') {
      systemPrompt = `Создай викторину. Для каждого слова придумай 3 НЕПРАВИЛЬНЫХ перевода на русском. Верни СТРОГО JSON-массив: [{"id": "id", "distractors": ["в1", "в2", "в3"]}].`;
      userPrompt = JSON.stringify(words.map((w:any) => ({ id: w.id, word: w.original, translation: w.translation })));
      
    // 3. Промпт для проверки предложений
    } else if (action === 'check') {
      systemPrompt = `Проверь предложение со словом "${word}". Уровень: ${level}. 
ОТВЕЧАЙ СТРОГО НА РУССКОМ ЯЗЫКЕ. Если есть ошибка в грамматике или контексте, обязательно напиши правильный вариант предложения.
Верни JSON: {"isCorrect": boolean, "feedback": "Подробный разбор ошибки на русском с правильным примером"}.`;
      userPrompt = sentence;
      
    // 4. Промпт для перегенерации примера
    } else if (action === 'example') {
      systemPrompt = `Придумай НОВЫЙ пример со словом "${word}" для уровня ${level}. Верни JSON: {"text": "Пример", "translation": "Перевод"}.`;
      userPrompt = word;
    }

    const response = await fetch("https://llm.api.cloud.yandex.net/foundationModels/v1/completion", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Api-Key ${YANDEX_API_KEY}` },
      body: JSON.stringify({
        // УСТАНОВЛЕНА ЛЕГКАЯ И ДЕШЕВАЯ МОДЕЛЬ ВЕЗДЕ
        modelUri: `gpt://${YANDEX_FOLDER_ID}/yandexgpt-lite/latest`, 
        completionOptions: { stream: false, temperature: 0.3, maxTokens: 2000 },
        messages: [{ role: "system", text: systemPrompt }, { role: "user", text: userPrompt }]
      }),
    });

    if (!response.ok) return new Response(JSON.stringify({ error: "Ошибка Yandex" }), { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });

    const data = await response.json();
    let parsedResult: any = {};
    try {
      parsedResult = JSON.parse((data.result?.alternatives?.[0]?.message?.text || "{}").replace(/```json/g, '').replace(/```/g, '').trim());
    } catch (e) {
      parsedResult = action === 'batch_distractors' ? [] : { translationOptions: ["Ошибка ИИ"], examples: [] };
    }
    
    return new Response(JSON.stringify(parsedResult), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }});
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
  }
};
