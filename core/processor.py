from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader


@dataclass
class SimpleDocument:
    page_content: str
    metadata: dict


def _split_text(text: str, chunk_size: int = 1000, chunk_overlap: int = 100) -> list[str]:
    cleaned = " ".join(text.split())
    if not cleaned:
        return []

    chunks = []
    start = 0
    step = max(1, chunk_size - chunk_overlap)

    while start < len(cleaned):
        end = start + chunk_size
        chunks.append(cleaned[start:end])
        start += step

    return chunks


def process_pdf(pdf_path: str | Path) -> list[SimpleDocument]:
    documents = []
    pdf_path = Path(pdf_path)
    reader = PdfReader(str(pdf_path))

    for page_number, page in enumerate(reader.pages, start=1):
        page_text = page.extract_text() or ""
        for chunk_index, chunk in enumerate(_split_text(page_text), start=1):
            documents.append(
                SimpleDocument(
                    page_content=chunk,
                    metadata={
                        "source": pdf_path.name,
                        "page": page_number,
                        "chunk": chunk_index,
                    },
                )
            )

    if not documents:
        raise ValueError(f"No readable PDF content found in {pdf_path}.")

    return documents


def process_pdfs(folder_path: str) -> list[SimpleDocument]:
    documents = []

    for pdf_path in sorted(Path(folder_path).glob("*.pdf")):
        documents.extend(process_pdf(pdf_path))

    if not documents:
        raise ValueError(f"No readable PDF content found in {folder_path}.")

    return documents


def process_selected_pdfs(pdf_paths: list[str | Path]) -> list[SimpleDocument]:
    documents = []

    for pdf_path in pdf_paths:
        documents.extend(process_pdf(pdf_path))

    if not documents:
        raise ValueError("No readable PDF content found in selected files.")

    return documents
