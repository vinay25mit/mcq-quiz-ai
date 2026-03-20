import os
import re
from dataclasses import dataclass

from huggingface_hub import InferenceClient


def _tokenize(text: str) -> set[str]:
    return set(re.findall(r"[a-zA-Z0-9]{3,}", text.lower()))


class LocalRetriever:
    def __init__(self, documents: list):
        self.documents = documents

    def search(self, query: str, k: int = 6) -> list:
        query_terms = _tokenize(query)
        scored_documents = []

        for document in self.documents:
            content_terms = _tokenize(document.page_content)
            overlap_score = len(query_terms.intersection(content_terms))
            length_bonus = min(len(document.page_content) / 1000, 1.0)
            score = overlap_score + length_bonus
            scored_documents.append((score, document))

        scored_documents.sort(key=lambda item: item[0], reverse=True)
        top_documents = [doc for score, doc in scored_documents[:k] if score > 0]
        return top_documents or self.documents[:k]


@dataclass
class ChatResponse:
    content: str


class HuggingFaceChatModel:
    def __init__(self, model: str, token: str, temperature: float = 0.5):
        self.client = InferenceClient(api_key=token)
        self.model = model
        self.temperature = temperature

    def invoke(self, prompt: str) -> ChatResponse:
        response = self.client.chat_completion(
            model=self.model,
            temperature=self.temperature,
            max_tokens=1200,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an exam preparation assistant. Generate concise explanations "
                        "and high-quality multiple-choice questions from study material."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
        )
        return ChatResponse(content=response.choices[0].message.content)


def get_mcq_agent(splits):
    hf_token = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACEHUB_API_TOKEN")
    if not hf_token:
        raise ValueError(
            "Missing Hugging Face token. Set HF_TOKEN or HUGGINGFACEHUB_API_TOKEN in .env."
        )

    chat_model = os.getenv("HF_CHAT_MODEL", "Qwen/Qwen2.5-7B-Instruct")
    retriever = LocalRetriever(splits)
    llm = HuggingFaceChatModel(model=chat_model, token=hf_token, temperature=0.5)
    return retriever, llm
