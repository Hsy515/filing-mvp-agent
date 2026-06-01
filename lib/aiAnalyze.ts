import { mockAnalyze } from "./mockAnalyze";
import type { FilingAnalysisResult } from "./types";

type ResponsesContent = {
  text?: string;
};

type ResponsesOutput = {
  content?: ResponsesContent[];
};

type ResponsesApiResult = {
  output_text?: string;
  output?: ResponsesOutput[];
};

function normalizeAiResult(result: FilingAnalysisResult): FilingAnalysisResult {
  return {
    ...result,
    source: "ai",
    review_id: result.review_id || `review_${Date.now()}`
  };
}

export async function aiAnalyze(materialText: string): Promise<FilingAnalysisResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) return null;

  try {
    const schemaHint = JSON.stringify(mockAnalyze(materialText), null, 2);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content:
              "Return JSON only. The JSON shape must match the provided filing review schema exactly."
          },
          {
            role: "user",
            content: `Material text:\n${materialText}\n\nSchema example:\n${schemaHint}`
          }
        ]
      })
    });

    if (!response.ok) return null;

    const data = (await response.json()) as ResponsesApiResult;
    const outputText =
      data.output_text ??
      data.output
        ?.flatMap((item) => item.content ?? [])
        .map((content) => content.text ?? "")
        .join("");

    if (!outputText) return null;

    return normalizeAiResult(JSON.parse(outputText) as FilingAnalysisResult);
  } catch {
    return null;
  }
}
