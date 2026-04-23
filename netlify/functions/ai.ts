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

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const YANDEX_API_KEY = "AQVN050LifyouJDKmjXZRUh7n7WWQSa4w7nVCfhY";
  const YANDEX_FOLDER_ID = "b1gt0i8u6inlaoafpmos";

  try {
    const { action = 'translate', word, sentence, correctTranslation, level } = await req.json();

    let systemPrompt = "";
    let userPrompt = "";

    if (action === 'translate') {
      systemPrompt = `Ты профессиональный лингвист. Твоя задача дать информацию о слове/выражении. 
ВАЖНО (Защита от опечаток): Если пользователь ввел слово с ошибкой (например aple), исправь его на правильное (apple) и верни в поле "original".
Транскрипции: Обязательно учитывай разницу между британским (UK) и американским (US) произношением (например, наличие звука /r/ или разные гласные).
Уровень ученика: ${level || 'Intermediate'}. Адаптируй сложность примеров.
Формат ответа строго JSON объект (без маркдауна): 
{
  "original": "Исправленное слово на английском",
  "translation": "Краткий перевод в 1-2 слова",
  "cambridgeTranslation": "Развернутый перевод в стиле Cambridge Dictionary",
  "transcriptionUK": "Британская транскрипция",
  "transcriptionUS": "Американская транскрипция",
  "examples": [
    {"text": "Пример на английском", "translation": "Перевод примера на русский"}
  ]
}`;
      userPrompt = word;
    } else if (action === 'distractors') {
      systemPrompt = `Ты создаешь викторину по языкам. Слово: "${word}". Правильный перевод: "${correctTranslation}". Дай 3 неправильных, но правдоподобных варианта ответа на русском. Ответ строго в виде JSON массива строк ["вар1", "вар2", "вар3"]. Без маркдауна.`;
      userPrompt = `Слово: ${word}. Перевод: ${correctTranslation}`;
    } else if (action === 'check') {
      systemPrompt = `Проверь предложение ученика со словом "${word}".
1. Грамматика.
2. Контекст (правильно ли использовано слово).
Верни JSON: {"isCorrect": boolean, "feedback": "Твой комментарий"}. Без маркдауна.`;
      userPrompt = sentence;
    } else if (action === 'example') {
      systemPrompt = `Придумай НОВЫЙ интересный пример использования слова "${word}". Уровень ученика: ${level || 'Intermediate'}.
Верни строго JSON объект: {"text": "Пример на английском", "translation": "Перевод на русский"}. Без маркдауна.`;
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
        completionOptions: { stream: false, temperature: action === 'example' ? 0.7 : 0.3, maxTokens: 1500 },
        messages: [
          { role: "system", text: systemPrompt },
          { role: "user", text: userPrompt }
        ]
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(JSON.stringify({ error: "Ошибка Yandex Cloud", details: errorText }), { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
    }

    const data = await response.json();
    const textOutput = data.result?.alternatives?.[0]?.message?.text || "{}";
    
    let parsedResult = {};
    try {
      const cleanedText = textOutput.replace(/```json/g, '').replace(/```/g, '').trim();
      parsedResult = JSON.parse(cleanedText);
    } catch (e) {
      parsedResult = action === 'distractors' ? [] : { translation: "Ошибка парсинга", examples: [] };
    }

    return new Response(JSON.stringify(parsedResult), {
      status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500, headers: { "Access-Control-Allow-Origin": "*" } 
    });
  }
};
