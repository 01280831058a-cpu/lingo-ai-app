import { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  // Настройка CORS для доступа из браузера
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

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Ключи берутся из Environment Variables в настройках сайта Netlify
  const YANDEX_API_KEY = process.env.YANDEX_API_KEY;
  const YANDEX_FOLDER_ID = process.env.YANDEX_FOLDER_ID; // Каталог Yandex Cloud (опционально, зависит от API)

  if (!YANDEX_API_KEY) {
    return new Response(JSON.stringify({ error: "Ключ YANDEX_API_KEY не настроен" }), { 
      status: 500,
      headers: { "Access-Control-Allow-Origin": "*" }
    });
  }

  try {
    const { action = 'translate', word, category, sentence, correctTranslation, level } = await req.json();

    let systemPrompt = "";
    let userPrompt = "";

    if (action === 'translate') {
      systemPrompt = `Ты профессиональный лингвист. Твоя задача выдать 3 наиболее частых перевода для слова/выражения "${word}". Категория: ${category}. ` +
         (level ? `Уровень ученика: ${level}. Адаптируй сложность примеров.` : ``) +
         ` Формат ответа строго JSON массив объектов: [{"text": "перевод", "examples": ["Пример использования на оригинальном языке"]}] без маркдауна и лишнего текста.`;
      userPrompt = word;
    } else if (action === 'distractors') {
      systemPrompt = `Ты создаешь викторину по изучению языков. Я дам тебе словарное слово и его правильный перевод. Дай мне строго 3 неправильных, но ПРАВДОПОДОБНЫХ и запутывающих варианта ответа на русском языке (которые не являются правильным переводом). Ответ строго в виде JSON массива строк. Без маркдауна.`;
      userPrompt = `Слово: ${word}. Правильный перевод: ${correctTranslation}`;
    } else if (action === 'check') {
      systemPrompt = `Ты строгий учитель. Ученик составил предложение со словом "${word}". Проверь:
1. Грамматику.
2. СМЫСЛ (использование слова в правильном контексте обязательно!).
Если есть ошибки в контексте или грамматике, isCorrect должен быть false.
Ответь строго в JSON: {"isCorrect": boolean, "feedback": "Строгий комментарий. Если ошибка - объясни почему и дай верный пример."}. Без маркдауна.`;
      userPrompt = sentence;
    } else if (action === 'examples') {
      systemPrompt = `Ты профессиональный лингвист. Сгенерируй 2 новых примера использования выражения "${word}" (Уровень ${level || 'Intermediate'}). Ответь строго в виде JSON массива строк: ["Предложение 1", "Предложение 2"]. Без маркдауна.`;
      userPrompt = word;
    } else {
      return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400 });
    }

    const response = await fetch("https://llm.api.cloud.yandex.net/foundationModels/v1/completion", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Api-Key ${YANDEX_API_KEY}`,
      },
      body: JSON.stringify({
        modelUri: `gpt://${YANDEX_FOLDER_ID}/yandexgpt/latest`,
        completionOptions: {
          stream: false,
          temperature: action === 'distractors' ? 0.7 : 0.3,
          maxTokens: 1000
        },
        messages: [
          { role: "system", text: systemPrompt },
          { role: "user", text: userPrompt }
        ]
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Yandex API Error:", errorText);
      return new Response(JSON.stringify({ error: "Ошибка от Yandex Cloud", details: errorText }), { 
        status: 500, headers: { "Access-Control-Allow-Origin": "*" } 
      });
    }

    const data = await response.json();
    
    // Yandex Foundation Models API возвращает структуру data.result.alternatives[0].message.text
    const textOutput = data.result?.alternatives?.[0]?.message?.text || "[]";
    
    // Пытаемся распарсить JSON из ответа ИИ
    let parsedResult = [];
    try {
      const cleanedText = textOutput.replace(/```json/g, '').replace(/```/g, '').trim();
      parsedResult = JSON.parse(cleanedText);
    } catch (e) {
      console.error("Failed to parse JSON from AI:", textOutput);
      parsedResult = [{ text: "Ошибка парсинга", examples: ["Убедитесь, что модель возвращает JSON."] }];
    }

    return new Response(JSON.stringify(parsedResult), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });

  } catch (err: any) {
    console.error("Function error:", err);
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500, headers: { "Access-Control-Allow-Origin": "*" } 
    });
  }
};
