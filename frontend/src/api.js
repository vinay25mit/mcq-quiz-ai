const API_URL =
  import.meta.env.VITE_API_URL || (import.meta.env.PROD ? "/api" : "http://localhost:4000/api");

function getToken() {
  return localStorage.getItem("auth_token");
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: "Request failed." }));
    throw new Error(payload.message || "Request failed.");
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/pdf")) {
    return response.blob();
  }

  return response.json();
}

export const api = {
  register: (payload) =>
    request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }),
  login: (payload) =>
    request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }),
  logout: () =>
    request("/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    }),
  me: () => request("/auth/me"),
  listPdfs: () => request("/pdfs"),
  uploadPdfs: (files) => {
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    return request("/pdfs/upload", {
      method: "POST",
      body: formData
    });
  },
  deletePdf: (name) =>
    request(`/pdfs/${encodeURIComponent(name)}`, {
      method: "DELETE"
    }),
  generateQuiz: (payload) =>
    request("/quiz/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }),
  exportPdf: (payload) =>
    request("/quiz/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
};
