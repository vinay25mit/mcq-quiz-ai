import { InferenceClient } from "@huggingface/inference";

import { config } from "../config.js";

const client = new InferenceClient(config.hfToken);

function getExamProfile(examStyle) {
  const label = (examStyle || "State PCS").trim();
  return {
    label,
    level:
      `${label} State PCS Preliminary exam level with medium-to-high difficulty, ` +
      "factual accuracy, concept clarity, and competitive one-best-answer distractors"
  };
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeQuestions(items) {
  const seen = new Set();
  const unique = [];

  for (const item of items) {
    const signature = normalizeText(item?.question);
    if (!signature || seen.has(signature)) continue;
    seen.add(signature);
    unique.push(item);
  }

  return unique;
}

function validateQuestion(item) {
  const options = item?.options || {};
  return (
    typeof item?.question === "string" &&
    item.question.trim() &&
    typeof options.A === "string" &&
    typeof options.B === "string" &&
    typeof options.C === "string" &&
    typeof options.D === "string" &&
    ["A", "B", "C", "D"].includes(item?.correct_answer) &&
    typeof item?.explanation === "string" &&
    item.explanation.trim()
  );
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text.trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Model response did not contain valid JSON.");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function normalizeSummary(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean)
      .map((item) => (item.startsWith("-") ? item : `- ${item}`))
      .join("\n");
  }
  return "";
}

async function askModel(prompt) {
  const response = await client.chatCompletion({
    model: config.hfChatModel,
    temperature: 0.4,
    max_tokens: 1200,
    messages: [
      {
        role: "system",
        content:
          "You are an exam preparation assistant. Return concise, high-quality JSON only."
      },
      { role: "user", content: prompt }
    ]
  });

  return response.choices?.[0]?.message?.content || "";
}

export async function generateSummary({ context, examStyle, customPrompt }) {
  const examProfile = getExamProfile(examStyle);
  const prompt = `
Context:
${context}

Task:
Create complete bullet-point revision notes for ${examProfile.label} preparation.
Return only valid JSON as one object.

Use this schema:
{
  "summary": "- Point 1\\n- Point 2\\n- Point 3"
}

Rules:
- The summary must be complete bullet points only.
- Each bullet must be to the point and exam-focused for ${examProfile.label}.
- The notes must match ${examProfile.level}.
- Cover important themes, facts, likely question areas, and revision takeaways.
- No markdown fences or text outside the JSON object.
${customPrompt ? `User preference: ${customPrompt}` : ""}
  `.trim();

  const payload = extractJson(await askModel(prompt));
  const summary = normalizeSummary(payload.summary);
  if (!summary) {
    throw new Error("Model did not return summary notes.");
  }
  return summary;
}

export async function generateQuestionBatch({
  context,
  batchCount,
  examStyle,
  customPrompt,
  startIndex,
  existingQuestions = []
}) {
  const examProfile = getExamProfile(examStyle);
  const existingQuestionList = existingQuestions.length
    ? existingQuestions.map((question, index) => `${index + 1}. ${question}`).join("\n")
    : "None";
  const prompt = `
Context:
${context}

Task:
Create exactly ${batchCount} MCQs for ${examProfile.label} preparation starting from question number ${startIndex}.
Return only valid JSON as one object.

Use this schema:
{
  "questions": [
    {
      "question": "Question text",
      "options": {
        "A": "Option A",
        "B": "Option B",
        "C": "Option C",
        "D": "Option D"
      },
      "correct_answer": "A",
      "explanation": "Short explanation based on the context",
      "source": "source filename"
    }
  ]
}

Rules:
- Return exactly ${batchCount} questions.
- Each question must have options A, B, C, D.
- correct_answer must be one of A, B, C, D.
- Match ${examProfile.level}.
- Questions must be suitable for State PCS Preliminary exam practice, not easy school-level recall.
- Cover varied topics or angles from the context instead of asking the same fact in different wording.
- Avoid repeated or near-duplicate questions within this batch and against the existing questions listed below.
- Use plausible distractors so only one option is clearly best.
- No markdown fences or text outside the JSON object.

Existing questions to avoid repeating:
${existingQuestionList}

${customPrompt ? `User preference: ${customPrompt}` : ""}
  `.trim();

  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const payload = extractJson(await askModel(prompt));
      const existingSignatures = new Set(existingQuestions.map((question) => normalizeText(question)));
      const questions = Array.isArray(payload.questions)
        ? dedupeQuestions(payload.questions).filter((question) => {
            const signature = normalizeText(question?.question);
            return validateQuestion(question) && signature && !existingSignatures.has(signature);
          })
        : [];
      if (questions.length < batchCount) {
        throw new Error(`Generated only ${questions.length} of ${batchCount} questions.`);
      }
      return questions.slice(0, batchCount);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Question batch generation failed: ${lastError?.message || "Unknown error"}`);
}

export async function generateQuizBundle({
  context,
  questionCount,
  examStyle,
  customPrompt
}) {
  const summary = await generateSummary({ context, examStyle, customPrompt });
  const questions = [];
  let attempts = 0;

  while (questions.length < questionCount && attempts < questionCount * 3) {
    attempts += 1;
    const remaining = questionCount - questions.length;
    const batch = await generateQuestionBatch({
      context,
      batchCount: Math.min(5, remaining),
      examStyle,
      customPrompt,
      startIndex: questions.length + 1,
      existingQuestions: questions.map((question) => question.question)
    });
    questions.push(...batch);
  }

  const uniqueQuestions = dedupeQuestions(questions).slice(0, questionCount);
  if (uniqueQuestions.length < questionCount) {
    throw new Error("Could not generate enough unique State PCS Preliminary level questions.");
  }

  return {
    summary,
    questions: uniqueQuestions
  };
}
