const inputText = document.getElementById("inputText");
const output = document.getElementById("output");
const outputLabel = document.getElementById("outputLabel");
const inputCount = document.getElementById("inputCount");
const outputCount = document.getElementById("outputCount");
const paraphraseBtn = document.getElementById("paraphraseBtn");
const copyBtn = document.getElementById("copyBtn");
const modeButtons = Array.from(document.querySelectorAll(".mode-btn"));

if (inputText && paraphraseBtn && output) {
  const activeBtn = document.querySelector(".mode-btn.active");
  let selectedMode = activeBtn?.dataset.mode || "Standard";
  let currentOutput = "";
  const idleLabel = paraphraseBtn.textContent.trim() || "Paraphrase";

  function wordCount(text) {
    const words = String(text).trim().match(/\S+/g);
    return words ? words.length : 0;
  }

  function resultTitle(mode) {
    return mode === "Summarize" ? "Summary" : "Rewritten text";
  }

  function updateCounts() {
    if (inputCount) inputCount.textContent = `${wordCount(inputText.value)} words`;
    if (outputCount) outputCount.textContent = `${wordCount(currentOutput)} words`;
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
    if (outputLabel) outputLabel.textContent = resultTitle(selectedMode);
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
      if (outputLabel) outputLabel.textContent = `${resultTitle(selectedMode)} (${selectedMode})`;
      updateCounts();
      if (copyBtn) copyBtn.disabled = false;
    } catch (err) {
      output.textContent = `Error: ${err.message}`;
    } finally {
      setLoading(false);
    }
  });

  if (copyBtn) {
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
  }

  function setLoading(loading) {
    paraphraseBtn.disabled = loading;
    if (copyBtn) copyBtn.disabled = loading || !currentOutput;
    if (loading) {
      paraphraseBtn.innerHTML = selectedMode === "Summarize"
        ? '<span class="spinner"></span>Summarizing...'
        : '<span class="spinner"></span>Rewording...';
    } else {
      paraphraseBtn.textContent = idleLabel;
    }
  }
}
