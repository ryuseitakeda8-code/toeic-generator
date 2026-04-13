export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { words, partStyle, cefrLevel } = body;

    if (!words || words.length === 0) {
      return new Response(
        JSON.stringify({ error: "単語が入力されていません" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const prompt = `
あなたはTOEIC問題作成者です。以下の単語を使ってJSON形式で問題を作成してください。

【対象単語】: ${words.join(", ")}
【形式】: ${partStyle}風
【難易度】: CEFR ${cefrLevel}

必ず以下のJSON構造のみを出力すること。マークダウンは禁止。

{
  "full_text": "完全な英文",
  "questions": [
    {
      "target_word": "単語",
      "blanked_text": "ブランク(_____)を含む文",
      "english_options": ["正解", "ダミー1", "ダミー2", "ダミー3"],
      "japanese_options": ["正解の意味", "ダミー1", "ダミー2", "ダミー3"]
    }
  ]
}
`;

    const models = [
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite"
    ];

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    let lastError = null;

    for (const model of models) {
      const geminiUrl =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

      for (let attempt = 1; attempt <= 3; attempt++) {
        const geminiRes = await fetch(geminiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              response_mime_type: "application/json",
            },
          }),
        });

        const raw = await geminiRes.text();
        console.log(`MODEL: ${model} / ATTEMPT: ${attempt} / STATUS: ${geminiRes.status}`);
        console.log(`RAW: ${raw}`);

        if (geminiRes.ok) {
          const data = JSON.parse(raw);
          const resultText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

          if (!resultText) {
            return new Response(
              JSON.stringify({ error: "生成結果が空です" }),
              { status: 500, headers: { "Content-Type": "application/json" } }
            );
          }

          return new Response(resultText, {
            headers: { "Content-Type": "application/json" },
          });
        }

        lastError = raw;

        // 503 のときだけ少し待って再試行
        if (geminiRes.status === 503 && attempt < 3) {
          await sleep(3000 * attempt);
          continue;
        }

        // 503 以外はこのモデルでの再試行を打ち切る
        break;
      }
    }

    return new Response(
      JSON.stringify({
        error: "Gemini API error",
        detail: lastError || "すべての候補モデルで失敗しました"
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "サーバーエラー",
        detail: error.message,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}