import { useEffect, useMemo, useState } from "react";

import { api } from "./api.js";

const initialForm = { name: "", email: "", password: "" };

function formatTime(seconds) {
  const total = Math.max(0, seconds);
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const secs = String(total % 60).padStart(2, "0");
  return `${minutes}:${secs}`;
}

export default function App() {
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState(initialForm);
  const [user, setUser] = useState(null);
  const [pdfs, setPdfs] = useState([]);
  const [selectedPdfs, setSelectedPdfs] = useState([]);
  const [examStyle, setExamStyle] = useState("BPSC");
  const [questionCount, setQuestionCount] = useState(5);
  const [timerMinutes, setTimerMinutes] = useState(10);
  const [customPrompt, setCustomPrompt] = useState("");
  const [quiz, setQuiz] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [submittedAnswers, setSubmittedAnswers] = useState({});
  const [selectedOption, setSelectedOption] = useState("");
  const [timeLeft, setTimeLeft] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deletingPdf, setDeletingPdf] = useState("");
  const [error, setError] = useState("");

  const answeredCount = Object.keys(submittedAnswers).length;
  const score = useMemo(() => {
    if (!quiz) return 0;
    return Object.entries(submittedAnswers).reduce((total, [index, answer]) => {
      return quiz.questions[Number(index)]?.correct_answer === answer ? total + 1 : total;
    }, 0);
  }, [quiz, submittedAnswers]);

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) {
      setLoading(false);
      return;
    }

    api
      .me()
      .then(({ user: currentUser }) => {
        setUser(currentUser);
        return api.listPdfs();
      })
      .then(({ pdfs: items }) => setPdfs(items))
      .catch(() => {
        localStorage.removeItem("auth_token");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!quiz || timeLeft <= 0) return undefined;
    const interval = window.setInterval(() => {
      setTimeLeft((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [quiz, timeLeft]);

  useEffect(() => {
    setSelectedOption(submittedAnswers[currentQuestion] || "");
  }, [currentQuestion, submittedAnswers]);

  async function refreshPdfs() {
    const { pdfs: items } = await api.listPdfs();
    setPdfs(items);
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload =
        authMode === "register"
          ? await api.register(authForm)
          : await api.login({ email: authForm.email, password: authForm.password });
      localStorage.setItem("auth_token", payload.token);
      setUser(payload.user);
      setAuthForm(initialForm);
      await refreshPdfs();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    await api.logout().catch(() => {});
    localStorage.removeItem("auth_token");
    setUser(null);
    setQuiz(null);
    setSubmittedAnswers({});
  }

  async function handleUpload(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setBusy(true);
    setError("");
    try {
      const { pdfs: items } = await api.uploadPdfs(files);
      setPdfs(items);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function handleGenerateQuiz() {
    if (!selectedPdfs.length) {
      setError("Select at least one PDF.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = await api.generateQuiz({
        pdfNames: selectedPdfs,
        examStyle,
        questionCount: Number(questionCount),
        customPrompt
      });
      setQuiz(payload);
      setCurrentQuestion(0);
      setSubmittedAnswers({});
      setSelectedOption("");
      setTimeLeft(Number(timerMinutes) * 60);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeletePdf(name) {
    setDeletingPdf(name);
    setError("");
    try {
      const { pdfs: items } = await api.deletePdf(name);
      setPdfs(items);
      setSelectedPdfs((currentSelection) =>
        currentSelection.filter((selectedName) => selectedName !== name)
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingPdf("");
    }
  }

  async function handleDownloadPdf() {
    if (!quiz) return;
    setBusy(true);
    try {
      const blob = await api.exportPdf({
        examStyle,
        summary: quiz.summary,
        questions: quiz.questions
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${examStyle.toLowerCase()}_mcqs.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function submitAnswer() {
    if (!selectedOption || !quiz) return;
    setSubmittedAnswers((current) => ({
      ...current,
      [currentQuestion]: selectedOption
    }));
  }

  function resetTest() {
    setQuiz(null);
    setCurrentQuestion(0);
    setSubmittedAnswers({});
    setSelectedOption("");
    setTimeLeft(0);
  }

  if (loading) return <div className="screen-center">Loading...</div>;

  if (!user) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>Practice Exam Console</h1>
          <p>React frontend with Express auth and quiz APIs.</p>
          <div className="tab-row">
            <button
              className={authMode === "login" ? "tab active" : "tab"}
              onClick={() => setAuthMode("login")}
            >
              Login
            </button>
            <button
              className={authMode === "register" ? "tab active" : "tab"}
              onClick={() => setAuthMode("register")}
            >
              Register
            </button>
          </div>
          <form className="auth-form" onSubmit={handleAuthSubmit}>
            {authMode === "register" ? (
              <input
                placeholder="Full name"
                value={authForm.name}
                onChange={(event) =>
                  setAuthForm((current) => ({ ...current, name: event.target.value }))
                }
              />
            ) : null}
            <input
              placeholder="Email"
              type="email"
              value={authForm.email}
              onChange={(event) =>
                setAuthForm((current) => ({ ...current, email: event.target.value }))
              }
            />
            <input
              placeholder="Password"
              type="password"
              value={authForm.password}
              onChange={(event) =>
                setAuthForm((current) => ({ ...current, password: event.target.value }))
              }
            />
            {error ? <div className="error">{error}</div> : null}
            <button disabled={busy} type="submit">
              {busy ? "Please wait..." : authMode === "register" ? "Create Account" : "Login"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const current = quiz?.questions?.[currentQuestion];
  const submittedAnswer = submittedAnswers[currentQuestion];

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>Practice Exam Console</h1>
          <p>PDF-based MCQ practice environment</p>
        </div>
        <div className="header-actions">
          <span>{user.name}</span>
          <button onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <div className="app-layout">
        <aside className="sidebar">
          {!quiz ? (
            <>
              <section className="panel">
                <h2>Test Setup</h2>
                <label className="upload-box">
                  <span>Upload PDF files</span>
                  <input type="file" accept=".pdf" multiple onChange={handleUpload} />
                </label>
              </section>
              <section className="panel">
                <h2>Uploaded PDFs</h2>
                <div className="pdf-table">
                  {pdfs.map((pdf) => (
                    <div key={pdf.name} className="pdf-row">
                      <label className="pdf-choice">
                        <input
                          type="checkbox"
                          checked={selectedPdfs.includes(pdf.name)}
                          onChange={(event) =>
                            setSelectedPdfs((currentSelection) =>
                              event.target.checked
                                ? [...currentSelection, pdf.name]
                                : currentSelection.filter((name) => name !== pdf.name)
                            )
                          }
                        />
                        <span>{pdf.name}</span>
                      </label>
                      <small>{(pdf.size / 1024).toFixed(1)} KB</small>
                      <button
                        type="button"
                        className="secondary danger-button"
                        onClick={() => handleDeletePdf(pdf.name)}
                        disabled={deletingPdf === pdf.name}
                      >
                        {deletingPdf === pdf.name ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
              <section className="panel">
                <h2>Configuration</h2>
                <label>
                  Exam Style
                  <select value={examStyle} onChange={(event) => setExamStyle(event.target.value)}>
                    <option value="BPSC">BPSC</option>
                    <option value="UPSC">UPSC</option>
                  </select>
                </label>
                <label>
                  Question Count
                  <input
                    type="number"
                    min="1"
                    max="25"
                    value={questionCount}
                    onChange={(event) => setQuestionCount(event.target.value)}
                  />
                </label>
                <label>
                  Timer (Minutes)
                  <input
                    type="number"
                    min="1"
                    max="180"
                    value={timerMinutes}
                    onChange={(event) => setTimerMinutes(event.target.value)}
                  />
                </label>
                <label>
                  Custom Prompt
                  <textarea
                    rows="4"
                    value={customPrompt}
                    onChange={(event) => setCustomPrompt(event.target.value)}
                  />
                </label>
                <button disabled={busy} onClick={handleGenerateQuiz}>
                  {busy ? "Generating..." : "Generate Quiz"}
                </button>
              </section>
            </>
          ) : (
            <>
              <section className="panel">
                <h2>Candidate Panel</h2>
                <div className="metric"><span>Time Left</span><strong>{formatTime(timeLeft)}</strong></div>
                <div className="metric"><span>Score</span><strong>{score}/{answeredCount}</strong></div>
                <div className="metric"><span>Answered</span><strong>{answeredCount}</strong></div>
                <div className="metric"><span>Remaining</span><strong>{quiz.questions.length - answeredCount}</strong></div>
                <button onClick={handleDownloadPdf}>Download Question Paper</button>
                <button className="secondary" onClick={resetTest}>Exit Test</button>
              </section>
              <section className="panel">
                <h2>Question Palette</h2>
                <div className="palette">
                  {quiz.questions.map((_, index) => (
                    <button
                      key={index}
                      className={
                        index === currentQuestion
                          ? "palette-btn active"
                          : submittedAnswers[index]
                            ? "palette-btn answered"
                            : "palette-btn"
                      }
                      onClick={() => setCurrentQuestion(index)}
                    >
                      {index + 1}
                    </button>
                  ))}
                </div>
              </section>
              <section className="panel">
                <h2>Bullet Notes</h2>
                <div className="notes-block">{quiz.summary}</div>
              </section>
            </>
          )}
        </aside>

        <main className="main-panel">
          {error ? <div className="error">{error}</div> : null}
          {!quiz ? (
            <section className="panel hero-panel">
              <h2>Test Configuration</h2>
              <div className="stats-grid">
                <div className="metric"><span>PDFs Available</span><strong>{pdfs.length}</strong></div>
                <div className="metric"><span>Selected PDFs</span><strong>{selectedPdfs.length}</strong></div>
                <div className="metric"><span>Exam Style</span><strong>{examStyle}</strong></div>
              </div>
            </section>
          ) : (
            <section className="panel question-panel">
              <div className="panel-header">
                <h2>Question Panel</h2>
                <div className="stats-inline">
                  <span>Score: {score}/{answeredCount}</span>
                  <span>Questions: {quiz.questions.length}</span>
                </div>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${((currentQuestion + 1) / quiz.questions.length) * 100}%` }}
                />
              </div>
              <div className="question-box">
                <div className="question-label-row">
                  <span className="question-label">Question No. {currentQuestion + 1}</span>
                  <span className="marks-label">Single Correct</span>
                </div>
                <p className="question-text">{current?.question}</p>
                <div className="options">
                  {["A", "B", "C", "D"].map((key) =>
                    current?.options?.[key] ? (
                      <label key={key} className="option-card">
                        <input
                          type="radio"
                          name={`question-${currentQuestion}`}
                          value={key}
                          checked={selectedOption === key}
                          onChange={(event) => setSelectedOption(event.target.value)}
                          disabled={Boolean(submittedAnswer) || timeLeft === 0}
                        />
                        <span className="option-letter">{key}.</span>
                        <span className="option-text">{current.options[key]}</span>
                      </label>
                    ) : null
                  )}
                </div>
                <div className="action-stack horizontal">
                  {!submittedAnswer ? (
                    <>
                      <button onClick={submitAnswer} disabled={!selectedOption || timeLeft === 0}>
                        Submit Answer
                      </button>
                      <button
                        className="secondary"
                        onClick={() =>
                          setCurrentQuestion((value) =>
                            Math.min(quiz.questions.length - 1, value + 1)
                          )
                        }
                        disabled={currentQuestion === quiz.questions.length - 1}
                      >
                        Skip
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() =>
                          setCurrentQuestion((value) =>
                            Math.min(quiz.questions.length - 1, value + 1)
                          )
                        }
                        disabled={currentQuestion === quiz.questions.length - 1}
                      >
                        Next Question
                      </button>
                    </>
                  )}
                </div>
                {submittedAnswer ? (
                  <>
                    <div
                      className={
                        submittedAnswer === current.correct_answer ? "result ok" : "result bad"
                      }
                    >
                      {submittedAnswer === current.correct_answer
                        ? "Correct answer."
                        : `Incorrect. Correct answer is ${current.correct_answer}.`}
                    </div>
                    <div className="explanation-box">
                      <strong>Explanation:</strong> {current.explanation}
                      <br />
                      <strong>Source:</strong> {current.source}
                    </div>
                  </>
                ) : null}
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
