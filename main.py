import json
import os
import re
import time
from io import BytesIO
from pathlib import Path

import pandas as pd
import streamlit as st
from dotenv import load_dotenv
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

from core.agent import get_mcq_agent
from core.processor import process_selected_pdfs

load_dotenv()
DATA_DIR = Path("./data")


def reset_quiz_state():
    st.session_state.exam_style = ""
    st.session_state.summary = ""
    st.session_state.mcqs = []
    st.session_state.current_question = 0
    st.session_state.selected_option = None
    st.session_state.answer_submitted = False
    st.session_state.score = 0
    st.session_state.answered_questions = set()
    st.session_state.quiz_started_at = None
    st.session_state.quiz_duration_seconds = 0
    st.session_state.selected_pdfs = []
    st.session_state.test_mode = False


def save_uploaded_pdf(uploaded_file) -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    destination = DATA_DIR / uploaded_file.name
    destination.write_bytes(uploaded_file.getbuffer())
    return destination


def list_available_pdfs() -> list[Path]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return sorted(DATA_DIR.glob("*.pdf"))


def build_pdf_table(pdf_paths: list[Path]) -> pd.DataFrame:
    rows = []
    for pdf_path in pdf_paths:
        stats = pdf_path.stat()
        rows.append(
            {
                "PDF Name": pdf_path.name,
                "Size (KB)": round(stats.st_size / 1024, 1),
            }
        )
    return pd.DataFrame(rows)


def apply_theme():
    st.markdown(
        """
        <style>
        :root {
            --bg: #f5f7fb;
            --panel: #ffffff;
            --panel-2: #f8fafc;
            --text: #1f2937;
            --muted: #6b7280;
            --accent: #2563eb;
            --accent-2: #1d4ed8;
            --border: #dbe3ef;
        }
        .stApp {
            background: var(--bg);
            color: var(--text);
        }
        [data-testid="stSidebar"] {
            background: #eef2f7;
            border-right: 1px solid var(--border);
        }
        [data-testid="stMetric"] {
            background: var(--panel);
            border: 1px solid var(--border);
            padding: 10px;
            border-radius: 12px;
        }
        [data-testid="stVerticalBlock"] div[data-testid="stVerticalBlockBorderWrapper"] {
            border-radius: 14px;
        }
        .stButton > button, .stDownloadButton > button {
            background: linear-gradient(90deg, var(--accent) 0%, var(--accent-2) 100%);
            color: #ffffff;
            border: none;
            font-weight: 700;
            border-radius: 10px;
        }
        .stButton > button:hover, .stDownloadButton > button:hover {
            filter: brightness(1.05);
        }
        div[data-baseweb="select"] > div,
        div[data-baseweb="input"] > div,
        textarea {
            background: var(--panel-2) !important;
            border-color: var(--border) !important;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def get_pdf_signatures(pdf_paths: list[str]) -> tuple:
    signatures = []
    for pdf_path in pdf_paths:
        stats = os.stat(pdf_path)
        signatures.append((pdf_path, stats.st_mtime, stats.st_size))
    return tuple(signatures)


def get_cached_resources(pdf_paths: list[str]):
    pdf_signatures = get_pdf_signatures(pdf_paths)
    cache_key = (
        pdf_signatures,
        os.getenv("HF_CHAT_MODEL", "Qwen/Qwen2.5-7B-Instruct"),
    )

    if st.session_state.get("resource_cache_key") != cache_key:
        chunks = process_selected_pdfs(pdf_paths)
        retriever, llm = get_mcq_agent(chunks)
        st.session_state.resource_cache_key = cache_key
        st.session_state.cached_retriever = retriever
        st.session_state.cached_llm = llm

    return st.session_state.cached_retriever, st.session_state.cached_llm


def extract_json_payload(raw_text: str):
    text = raw_text.strip()
    fence_match = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1).strip()

    start_obj = text.find("{")
    end_obj = text.rfind("}")
    if start_obj == -1 or end_obj == -1:
        raise ValueError("Model response did not contain valid JSON.")

    payload = json.loads(text[start_obj : end_obj + 1])
    if not isinstance(payload, dict):
        raise ValueError("Model response did not contain the expected JSON object.")
    return payload


def normalize_summary(summary_value) -> str:
    if isinstance(summary_value, str):
        return summary_value.strip()
    if isinstance(summary_value, list):
        bullet_lines = []
        for item in summary_value:
            text = str(item).strip()
            if text:
                bullet_lines.append(text if text.startswith("-") else f"- {text}")
        return "\n".join(bullet_lines).strip()
    if summary_value is None:
        return ""
    return str(summary_value).strip()


def build_context(pdf_paths: list[str], question_count: int):
    retriever, llm = get_cached_resources(pdf_paths)

    query = (
        f"Generate exactly {question_count} multiple-choice questions from the provided study material."
    )
    docs = retriever.search(query, k=min(8, max(4, question_count * 2)))
    context = "\n".join(
        [
            f"Source: {d.metadata.get('source', 'Unknown')}\nContent: {d.page_content}"
            for d in docs
        ]
    )
    return llm, context


def generate_summary(llm, context: str, exam_style: str, custom_prompt: str) -> str:
    custom_instruction = (
        f"\nUser preference: {custom_prompt.strip()}" if custom_prompt.strip() else ""
    )

    prompt = f"""
Context:
{context}

Task:
Create complete bullet-point revision notes for {exam_style} preparation.
Return only valid JSON as one object.

Use this schema:
{{
  "summary": "- Point 1\\n- Point 2\\n- Point 3"
}}

Rules:
- The summary must be complete bullet points only.
- Each bullet must be to the point and exam-focused for {exam_style}.
- Cover the important themes, facts, likely question areas, and revision takeaways.
- Do not write a paragraph-style summary.
- Do not include markdown, code fences, or extra text outside the JSON object.
{custom_instruction}
""".strip()

    response = llm.invoke(prompt)
    payload = extract_json_payload(response.content)
    summary = normalize_summary(payload.get("summary", ""))

    if not summary:
        raise ValueError("Model response did not contain a summary.")

    return summary


def generate_question_batch(
    llm,
    context: str,
    batch_count: int,
    exam_style: str,
    custom_prompt: str,
    start_index: int,
) -> list[dict]:
    custom_instruction = (
        f"\nUser preference: {custom_prompt.strip()}" if custom_prompt.strip() else ""
    )

    prompt = f"""
Context:
{context}

Task:
Create exactly {batch_count} MCQs for {exam_style} preparation starting from question number {start_index}.
Return only valid JSON as one object.

Use this schema:
{{
  "questions": [
    {{
      "question": "Question text",
      "options": {{
        "A": "Option A",
        "B": "Option B",
        "C": "Option C",
        "D": "Option D"
      }},
      "correct_answer": "A",
      "explanation": "Short explanation based on the context",
      "source": "source filename"
    }}
  ]
}}

Rules:
- Return exactly {batch_count} question items.
- Each question must have 4 options labeled A, B, C, D.
- The correct_answer must be one of A, B, C, D.
- The explanation must explain why the correct answer is right.
- Questions should reflect the tone and difficulty commonly seen in {exam_style}.
- Avoid repeating earlier questions in this batch.
- Do not include markdown, code fences, or extra text outside the JSON object.
{custom_instruction}
""".strip()

    last_error = None
    for _ in range(3):
        try:
            response = llm.invoke(prompt)
            payload = extract_json_payload(response.content)
            questions = payload.get("questions", [])

            if not isinstance(questions, list) or not questions:
                raise ValueError("Model response did not contain any quiz questions.")

            if len(questions) < batch_count:
                raise ValueError(
                    f"Generated only {len(questions)} questions for a batch of {batch_count}."
                )

            return questions[:batch_count]
        except Exception as exc:
            last_error = exc

    raise ValueError(f"Question batch generation failed: {last_error}")


def generate_quiz_bundle(
    llm, context: str, question_count: int, exam_style: str, custom_prompt: str
) -> tuple[str, list[dict]]:
    summary = generate_summary(llm, context, exam_style, custom_prompt)
    questions = []
    batch_size = 5

    while len(questions) < question_count:
        remaining = question_count - len(questions)
        batch_questions = generate_question_batch(
            llm=llm,
            context=context,
            batch_count=min(batch_size, remaining),
            exam_style=exam_style,
            custom_prompt=custom_prompt,
            start_index=len(questions) + 1,
        )
        questions.extend(batch_questions)

        if len(batch_questions) == 0:
            break

    questions = questions[:question_count]
    if len(questions) != question_count:
        raise ValueError(
            f"Could not generate the requested number of questions. Generated {len(questions)} of {question_count}."
        )

    return summary, questions


def build_mcq_pdf(summary: str, mcqs: list[dict], exam_style: str) -> bytes:
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=36,
    )
    styles = getSampleStyleSheet()
    title_style = styles["Title"]
    heading_style = styles["Heading2"]
    body_style = styles["BodyText"]
    body_style.leading = 16

    story = [Paragraph(f"{exam_style} MCQ Set", title_style), Spacer(1, 12)]
    story.append(Paragraph("Bullet Notes", heading_style))
    for line in summary.splitlines():
        stripped = line.strip()
        if stripped:
            story.append(Paragraph(stripped, body_style))
    story.append(Spacer(1, 12))

    for index, question in enumerate(mcqs, start=1):
        story.append(Paragraph(f"Question {index}", heading_style))
        story.append(Paragraph(question.get("question", "Question unavailable"), body_style))
        story.append(Spacer(1, 6))

        options = question.get("options", {})
        for key in ["A", "B", "C", "D"]:
            if key in options:
                story.append(Paragraph(f"{key}. {options[key]}", body_style))
        story.append(Spacer(1, 12))

    story.append(PageBreak())
    story.append(Paragraph("Answer Key", title_style))
    story.append(Spacer(1, 12))

    for index, question in enumerate(mcqs, start=1):
        answer = question.get("correct_answer", "N/A")
        explanation = question.get("explanation", "No explanation provided.")
        source = question.get("source", "Unknown")
        story.append(Paragraph(f"{index}. Correct Answer: {answer}", heading_style))
        story.append(Paragraph(f"Explanation: {explanation}", body_style))
        story.append(Paragraph(f"Source: {source}", body_style))
        story.append(Spacer(1, 10))

    doc.build(story)
    return buffer.getvalue()


def get_remaining_seconds() -> int:
    started_at = st.session_state.get("quiz_started_at")
    duration = st.session_state.get("quiz_duration_seconds", 0)
    if not started_at or not duration:
        return 0
    elapsed = int(time.time() - started_at)
    return max(duration - elapsed, 0)


def format_duration(seconds: int) -> str:
    minutes, secs = divmod(max(seconds, 0), 60)
    return f"{minutes:02d}:{secs:02d}"


def render_question_palette(total_questions: int):
    st.sidebar.subheader("Question Palette")
    for start in range(0, total_questions, 5):
        cols = st.sidebar.columns(5)
        for offset, col in enumerate(cols):
            question_index = start + offset
            if question_index >= total_questions:
                continue
            label = str(question_index + 1)
            if question_index in st.session_state.answered_questions:
                label = f"{label}*"
            if col.button(label, key=f"palette_{question_index}", use_container_width=True):
                st.session_state.current_question = question_index
                st.session_state.selected_option = None
                st.session_state.answer_submitted = False
                st.rerun()


def render_test_header(total_questions: int):
    remaining_seconds = get_remaining_seconds()
    time_up = remaining_seconds == 0 and st.session_state.quiz_started_at is not None
    header_cols = st.columns([2, 1, 1])
    header_cols[0].markdown("### Question Panel")
    header_cols[1].metric(
        "Score", f"{st.session_state.score}/{len(st.session_state.answered_questions)}"
    )
    header_cols[2].metric("Questions", total_questions)
    if time_up:
        st.warning("Time is up. You can review the test and download the PDF.")
    return remaining_seconds, time_up


def render_setup_screen(available_pdfs: list[Path]):
    with st.sidebar:
        st.header("Test Setup")
        uploaded_files = st.file_uploader(
            "Upload PDF files",
            type=["pdf"],
            accept_multiple_files=True,
        )

        if uploaded_files:
            for uploaded_file in uploaded_files:
                save_uploaded_pdf(uploaded_file)
            available_pdfs = list_available_pdfs()
            st.success("Uploaded PDF files are ready.")

        st.subheader("Uploaded PDFs")
        if available_pdfs:
            st.table(build_pdf_table(available_pdfs))
        else:
            st.info("No PDFs uploaded yet.")

        selected_pdf_names = st.multiselect(
            "Choose PDF(s)",
            options=[pdf.name for pdf in available_pdfs] if available_pdfs else [],
            default=st.session_state.get("selected_pdfs", []),
            placeholder="Select one or more PDFs",
        )
        exam_style = st.selectbox("Exam Style", ["BPSC", "UPSC"])
        question_count = st.number_input(
            "Question Count",
            min_value=1,
            max_value=20,
            value=3,
            step=1,
        )
        timer_minutes = st.number_input(
            "Timer (Minutes)",
            min_value=1,
            max_value=180,
            value=max(5, int(question_count) * 2),
            step=1,
        )
        custom_prompt = st.text_area(
            "Custom Prompt",
            placeholder="Example: Focus on factual one-liners, committee reports, schemes, or Bihar-specific current affairs.",
        )
        generate_clicked = st.button("Generate Quiz", use_container_width=True)

    st.subheader("Test Configuration")
    top_col1, top_col2, top_col3 = st.columns(3)
    top_col1.metric("PDFs Available", len(available_pdfs))
    top_col2.metric("Selected PDFs", len(selected_pdf_names))
    top_col3.metric("Exam Style", exam_style)

    if selected_pdf_names:
        st.info(f"Selected PDF(s): {', '.join(selected_pdf_names)}")

    return (
        available_pdfs,
        selected_pdf_names,
        exam_style,
        question_count,
        timer_minutes,
        custom_prompt,
        generate_clicked,
    )


def render_test_screen():
    mcqs = st.session_state.mcqs
    remaining_seconds, time_up = render_test_header(len(mcqs))
    pdf_bytes = build_mcq_pdf(
        st.session_state.summary, mcqs, st.session_state.exam_style
    )

    with st.sidebar:
        st.header("Candidate Panel")
        st.write(f"Exam: {st.session_state.exam_style} Practice Test")
        st.write(f"Sources: {', '.join(st.session_state.selected_pdfs)}")
        st.metric("Time Left", format_duration(remaining_seconds))
        st.metric(
            "Score", f"{st.session_state.score}/{len(st.session_state.answered_questions)}"
        )
        st.write(f"Answered: {len(st.session_state.answered_questions)}")
        st.write(f"Remaining: {len(mcqs) - len(st.session_state.answered_questions)}")
        st.download_button(
            "Download Question Paper",
            data=pdf_bytes,
            file_name=f"{st.session_state.exam_style.lower()}_mcqs.pdf",
            mime="application/pdf",
            use_container_width=True,
        )
        with st.expander("Bullet Notes", expanded=False):
            st.write(st.session_state.summary)
        render_question_palette(len(mcqs))
        if st.button("Exit Test", use_container_width=True):
            reset_quiz_state()
            st.rerun()

    index = st.session_state.current_question
    question = mcqs[index]

    with st.container(border=True):
        progress = (index + 1) / len(mcqs)
        st.progress(progress, text=f"Question {index + 1} of {len(mcqs)}")
        st.subheader(f"Question {index + 1}")
        st.write(question.get("question", "Question unavailable"))

        options = question.get("options", {})
        option_keys = [key for key in ["A", "B", "C", "D"] if key in options]
        option_labels = [f"{key}. {options[key]}" for key in option_keys]

        if not st.session_state.answer_submitted:
            selected_label = st.radio(
                "Choose your answer:",
                option_labels,
                index=None,
                key=f"question_{index}",
                disabled=time_up,
            )

            action_cols = st.columns(2)
            if action_cols[0].button("Submit Answer", use_container_width=True):
                if time_up:
                    st.warning("Timer ended. You can no longer submit answers.")
                elif not selected_label:
                    st.warning("Select an option before submitting.")
                else:
                    st.session_state.selected_option = selected_label.split(".", 1)[0]
                    st.session_state.answer_submitted = True
                    if index not in st.session_state.answered_questions:
                        st.session_state.answered_questions.add(index)
                        if (
                            st.session_state.selected_option
                            == question.get("correct_answer", "").strip().upper()
                        ):
                            st.session_state.score += 1
                    st.rerun()
            if index < len(mcqs) - 1 and action_cols[1].button(
                "Skip", use_container_width=True
            ):
                st.session_state.current_question += 1
                st.session_state.selected_option = None
                st.session_state.answer_submitted = False
                st.rerun()
        else:
            selected_option = st.session_state.selected_option
            correct_answer = question.get("correct_answer", "").strip().upper()

            if selected_option == correct_answer:
                st.success("Correct answer.")
            else:
                st.error(
                    f"Incorrect. You chose {selected_option}, correct answer is {correct_answer}."
                )

            st.write(
                f"Explanation: {question.get('explanation', 'No explanation provided.')}"
            )
            st.write(f"Source: {question.get('source', 'Unknown')}")

            nav_col1, nav_col2 = st.columns(2)
            if index < len(mcqs) - 1:
                if nav_col1.button("Next Question", use_container_width=True):
                    st.session_state.current_question += 1
                    st.session_state.selected_option = None
                    st.session_state.answer_submitted = False
                    st.rerun()
            else:
                nav_col1.success("Quiz complete.")
                if nav_col2.button("Finish Test", use_container_width=True):
                    st.session_state.test_mode = False
                    st.rerun()


apply_theme()
st.title("Practice Exam Console")
st.caption("PDF-based MCQ practice environment")

if "mcqs" not in st.session_state:
    reset_quiz_state()
if "resource_cache_key" not in st.session_state:
    st.session_state.resource_cache_key = None
    st.session_state.cached_retriever = None
    st.session_state.cached_llm = None

available_pdfs = list_available_pdfs()
if st.session_state.get("test_mode") and st.session_state.mcqs:
    render_test_screen()
else:
    (
        available_pdfs,
        selected_pdf_names,
        exam_style,
        question_count,
        timer_minutes,
        custom_prompt,
        generate_clicked,
    ) = render_setup_screen(available_pdfs)

    if generate_clicked:
        if selected_pdf_names:
            try:
                with st.spinner("Analyzing documents and generating quiz..."):
                    selected_pdf_paths = [str(DATA_DIR / name) for name in selected_pdf_names]
                    llm, context = build_context(selected_pdf_paths, int(question_count))
                    st.session_state.exam_style = exam_style
                    st.session_state.selected_pdfs = selected_pdf_names
                    st.session_state.summary, st.session_state.mcqs = generate_quiz_bundle(
                        llm, context, int(question_count), exam_style, custom_prompt
                    )
                    st.session_state.current_question = 0
                    st.session_state.selected_option = None
                    st.session_state.answer_submitted = False
                    st.session_state.score = 0
                    st.session_state.answered_questions = set()
                    st.session_state.quiz_started_at = time.time()
                    st.session_state.quiz_duration_seconds = int(timer_minutes) * 60
                    st.session_state.test_mode = True
                    st.rerun()
            except Exception as exc:
                reset_quiz_state()
                st.error(f"Failed to generate quiz: {type(exc).__name__}: {exc}")
        else:
            st.error("Select at least one PDF before generating the quiz.")
