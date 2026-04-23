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
    const { word, category } = await req.json();

    // Формируем системный промпт
    const systemPrompt = `Ты профессиональный лингвист. Твоя задача выдать 3 наиболее частых перевода для слова/выражения "${word}". Категория: ${category}. Формат ответа строго JSON массив объектов: [{"text": "перевод", "examples": ["Пример использования на оригинальном языке"]}] без маркдауна и лишнего текста.`;

    // Выполняем http-запрос к Yandex Cloud (используем эндпоинт, совместимый с OpenAI, если DeepSeek развернут там)
    // Либо меняйте этот URL на нужный вам эндпоинт в Yandex Cloud (например, Foundation Models API)
    const response = await fetch("https://llm.api.cloud.yandex.net/foundationModels/v1/completion", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Api-Key ${YANDEX_API_KEY}`,
        // "x-folder-id": YANDEX_FOLDER_ID || "",
      },
      body: JSON.stringify({
        modelUri: `gpt://${YANDEX_FOLDER_ID}/yandexgpt/latest`, // Замените URI модели на DeepSeek 3.2, если он зарегистрирован там
        completionOptions: {
          stream: false,
          temperature: 0.3,
          maxTokens: 1000
        },
        messages: [
          { role: "system", text: systemPrompt },
          { role: "user", text: word }
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
