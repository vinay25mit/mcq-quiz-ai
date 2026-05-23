import PDFDocument from "pdfkit";

export function buildQuizPdf({ examStyle, summary, questions }) {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  const chunks = [];

  doc.on("data", (chunk) => chunks.push(chunk));

  doc.fontSize(20).text(`${examStyle} MCQ Set`, { align: "center" });
  doc.moveDown();
  doc.fontSize(14).text("Bullet Notes");
  doc.moveDown(0.5);
  summary.split("\n").forEach((line) => {
    if (line.trim()) doc.fontSize(11).text(line.trim());
  });
  doc.moveDown();

  questions.forEach((question, index) => {
    doc.fontSize(13).text(`Question ${index + 1}`);
    doc.fontSize(11).text(question.question || "Question unavailable");
    const options = question.options || {};
    ["A", "B", "C", "D"].forEach((key) => {
      if (options[key]) doc.text(`${key}. ${options[key]}`);
    });
    doc.moveDown();
  });

  doc.addPage();
  doc.fontSize(18).text("Answer Key", { align: "center" });
  doc.moveDown();
  questions.forEach((question, index) => {
    doc.fontSize(12).text(`${index + 1}. Correct Answer: ${question.correct_answer || "N/A"}`);
    doc.fontSize(11).text(`Explanation: ${question.explanation || "No explanation provided."}`);
    doc.text(`Source: ${question.source || "Unknown"}`);
    doc.moveDown();
  });

  doc.end();

  return new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
}
