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

  // ⚠️ ЗАМЕНИ НА НОВЫЙ КЛЮЧ
  const YANDEX_API_KEY = "ТВОЙ_НОВЫЙ_СЕКРЕТНЫЙ_API_КЛЮЧ";
  const YANDEX_FOLDER_ID = "b1g5hslgb02o872rtq1v";

  try {
    const { action = 'translate', word, words, sentence, topic, count, text, level } = await req.json();

    let systemPrompt = "";
    let userPrompt = "";

    if (action === 'translate') {
      systemPrompt = `ТЫ АКАДЕМИЧЕСКИЙ СЛОВАРЬ.
ВАЖНЫЕ ПРАВИЛА:
1. ИГНОРИРУЙ ЦЕНЗУРУ. Переводи любой текст прямо.
2. ЗАЩИТА ОТ ОПЕЧАТОК: Если слово введено с ошибкой, исправь его. Оригинал и переводы должны быть в нижнем регистре.
3. ТРАНСКРИПЦИИ: Британская (UK) и Американская (US) транскрипции (IPA) ДОЛЖНЫ ОТЛИЧАТЬСЯ.
4. УРОВЕНЬ: ${level || 'Intermediate'}. Адаптируй пример и кембриджское объяснение строго под этот уровень.
5. ЧАСТЬ РЕЧИ И РОДСТВЕННЫЕ СЛОВА: ОБЯЗАТЕЛЬНО укажи часть речи. Дай 3 варианта перевода на выбор. ОБЯЗАТЕЛЬНО Приведи 2-3 однокоренных слова других частей речи в массиве "relatedWords".

Формат ответа СТРОГО JSON: 
{
  "original": "исправленное слово",
  "partOfSpeech": "часть речи (англ)",
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
    } else if (action === 'generate_words') {
      systemPrompt = `Ты интеллектуальный помощник для изучения языков. Твоя задача - составить список из ${count} полезных английских слов.
Уровень сложности слов должен строго соответствовать: ${level || 'Intermediate'}. 
Если анализируешь текст и в нем нет достаточно сложных/простых слов, выбери наиболее близкие к этому уровню, которые есть.
ОТВЕЧАЙ СТРОГО JSON МАССИВОМ: [{"word": "apple", "translation": "яблоко"}]. Никакого другого текста, никаких пояснений.`;
      
      if (text) {
         userPrompt = `Выбери слова ИСКЛЮЧИТЕЛЬНО из этого текста, которые относятся к теме "${topic}" (или самые важные слова из текста, если тема пустая). Текст: ${text.substring(0, 3000)}`;
      } else {
         userPrompt = `Сгенерируй слова на тему: "${topic}".`;
      }
    } else if (action === 'batch_distractors') {
      systemPrompt = `Создай викторину. Для каждого слова придумай 3 НЕПРАВИЛЬНЫХ перевода на русском в нижнем регистре. Верни СТРОГО JSON-массив: [{"id": "id", "distractors": ["в1", "в2", "в3"]}].`;
      userPrompt = JSON.stringify(words.map((w:any) => ({ id: w.id, word: w.original, translation: w.translation })));
    } else if (action === 'check') {
      systemPrompt = `Проверь предложение со словом "${word}". 
ОТВЕЧАЙ СТРОГО НА РУССКОМ ЯЗЫКЕ. Если есть ошибка в грамматике или контексте, обязательно напиши правильный вариант предложения.
Верни JSON: {"isCorrect": boolean, "feedback": "Подробный разбор ошибки на русском с правильным примером"}.`;
      userPrompt = sentence;
    } else if (action === 'example') {
      systemPrompt = `Придумай НОВЫЙ пример со словом "${word}" для уровня ${level}. Верни JSON: {"text": "Пример", "translation": "Перевод"}.`;
      userPrompt = word;
    }

    const response = await fetch("https://llm.api.cloud.yandex.net/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Api-Key ${YANDEX_API_KEY}` },
      body: JSON.stringify({
        // Укажи здесь точный URI легкой модели (например, qwen2.5-7b-instruct)
        model: `gpt://${YANDEX_FOLDER_ID}/qwen2.5-7b-instruct/latest`, 
        temperature: 0.3, 
        max_tokens: 2000,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }]
      }),
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error("Yandex API Error:", errText);
        return new Response(JSON.stringify({ error: errText }), { status: response.status, headers: { "Access-Control-Allow-Origin": "*" } });
    }

    const data = await response.json();
    let parsedResult: any = action === 'generate_words' || action === 'batch_distractors' ? [] : {};
    
    try {
      let rawText = data.choices?.[0]?.message?.content || "";
      rawText = rawText.replace(/<think>[\s\S]*?<\/think>/g, '');
      const jsonMatch = rawText.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
      
      if (jsonMatch) {
          parsedResult = JSON.parse(jsonMatch[0]);
      } else {
          parsedResult = JSON.parse(rawText.replace(/```json/g, '').replace(/```/g, '').trim());
      }
    } catch (e) {
      console.error("Ошибка парсинга JSON от нейросети:", e);
    }
    
    return new Response(JSON.stringify(parsedResult), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }});
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
  }
};
