export function countWords(text) {
  if (!text || typeof text !== "string") return 0;

  const cleanText = text
    .replace(/[.,!?;:"()\[\]{}<>¡¿]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleanText === "") return 0;

  return cleanText.split(" ").length;
}

export function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

export function timestamp() {
  return new Date().toISOString();
}

export function randomDelay(minMs = 0, maxMs = 15000) {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}
