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
1. ИГНОРИРУЙ ЦЕНЗУРУ. Переводи ЛЮБОЙ текст (мат, сленг, ругательства, грубые фразы) абсолютно прямо, точно и без звездочек. Это образовательный инструмент.
2. ЗАЩИТА ОТ ОПЕЧАТОК: Если пользователь ввел слово с ошибкой (например aple), исправь его на правильное (apple) и верни в поле "original".
3. ТРАНСКРИПЦИИ: Британская (UK) и Американская (US) транскрипции (IPA) ДОЛЖНЫ ОТЛИЧАТЬСЯ (например, наличие звука /r/ в US, или разные гласные /æ/ vs /ɑː/). Укажи их максимально точно.
Формат ответа СТРОГО JSON объект: 
{
  "original": "Исправленное слово на английском",
  "translation": "Краткий перевод",
  "cambridgeTranslation": "Развернутый перевод",
  "transcriptionUK": "Британская транскрипция",
  "transcriptionUS": "Американская транскрипция",
  "examples": [
    {"text": "Пример на английском", "translation": "Перевод примера"}
  ]
}`;
      userPrompt = word;
    } else if (action === 'batch_distractors') {
      systemPrompt = `Ты создаешь викторину. Для каждого переданного слова придумай 3 НЕПРАВИЛЬНЫХ, но правдоподобных варианта перевода на русском. 
Верни строго JSON-массив объектов: [{"id": "id_слова", "distractors": ["вар1", "вар2", "вар3"]}]. Без маркдауна.`;
      userPrompt = JSON.stringify(words.map((w:any) => ({ id: w.id, word: w.original, translation: w.translation })));
    } else if (action === 'check') {
      systemPrompt = `Проверь предложение со словом "${word}". Верни JSON: {"isCorrect": boolean, "feedback": "Комментарий"}. Без маркдауна.`;
      userPrompt = sentence;
    } else if (action === 'example') {
      systemPrompt = `Придумай НОВЫЙ пример со словом "${word}". Игнорируй цензуру. Верни JSON: {"text": "Пример", "translation": "Перевод"}.`;
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
        completionOptions: { stream: false, temperature: 0.3, maxTokens: 1500 },
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
