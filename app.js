const inputText = document.getElementById("inputText");
const output = document.getElementById("output");
const outputLabel = document.getElementById("outputLabel");
const inputCount = document.getElementById("inputCount");
const outputCount = document.getElementById("outputCount");
const paraphraseBtn = document.getElementById("paraphraseBtn");
const copyBtn = document.getElementById("copyBtn");
const modeButtons = Array.from(document.querySelectorAll(".mode-btn"));

let selectedMode = "Standard";
let currentOutput = "";

function wordCount(text) {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}

function updateCounts() {
  inputCount.textContent = `${wordCount(inputText.value)} words`;
  outputCount.textContent = `${wordCount(currentOutput)} words`;
}

modeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    modeButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    selectedMode = btn.dataset.mode;
  });
});

inputText.addEventListener("input", updateCounts);

paraphraseBtn.addEventListener("click", async () => {
  const text = inputText.value.trim();
  if (!text) {
    inputText.focus();
    return;
  }

  setLoading(true);
  output.textContent = "";
  currentOutput = "";
  outputLabel.textContent = "Rewritten text";
  updateCounts();

  try {
    const res = await fetch("/api/paraphrase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, mode: selectedMode }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    currentOutput = data.output;
    output.textContent = currentOutput;
    outputLabel.textContent = `Rewritten text (${selectedMode})`;
    updateCounts();
    copyBtn.disabled = false;
  } catch (err) {
    output.textContent = `Error: ${err.message}`;
  } finally {
    setLoading(false);
  }
});

copyBtn.addEventListener("click", async () => {
  if (!currentOutput) return;
  try {
    await navigator.clipboard.writeText(currentOutput);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = currentOutput;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  copyBtn.textContent = "Copied!";
  setTimeout(() => {
    copyBtn.textContent = "Copy";
  }, 1500);
});

function setLoading(loading) {
  paraphraseBtn.disabled = loading;
  copyBtn.disabled = loading || !currentOutput;
  if (loading) {
    paraphraseBtn.innerHTML = '<span class="spinner"></span>Rewording...';
  } else {
    paraphraseBtn.textContent = "Paraphrase";
  }
}
