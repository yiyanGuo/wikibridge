const API_URL = "http://127.0.0.1:19827";

const statusBar = document.getElementById("statusBar");
const titleInput = document.getElementById("titleInput");
const urlPreview = document.getElementById("urlPreview");
const contentPreview = document.getElementById("contentPreview");
const clipBtn = document.getElementById("clipBtn");
const projectSelect = document.getElementById("projectSelect");

let extractedContent = "";
let pageUrl = "";

// Check connection and load projects
async function checkConnection() {
  try {
    const res = await fetch(`${API_URL}/status`, { method: "GET" });
    const data = await res.json();
    if (data.ok) {
      statusBar.className = "status connected";
      statusBar.textContent = "✓ Connected to LLM Wiki";
      await loadProjects();
      return true;
    }
  } catch {
    // not running
  }
  statusBar.className = "status disconnected";
  statusBar.textContent = "✗ LLM Wiki app is not running";
  clipBtn.disabled = true;
  projectSelect.innerHTML = '<option value="">App not running</option>';
  return false;
}

// Load project list from server
async function loadProjects() {
  try {
    const res = await fetch(`${API_URL}/projects`, { method: "GET" });
    const data = await res.json();
    if (data.ok && data.projects) {
      projectSelect.innerHTML = "";

      if (data.projects.length === 0) {
        projectSelect.innerHTML = '<option value="">No projects found</option>';
        return;
      }

      for (const proj of data.projects) {
        const opt = document.createElement("option");
        opt.value = proj.path;
        opt.textContent = proj.name + (proj.current ? " (current)" : "");
        if (proj.current) opt.selected = true;
        projectSelect.appendChild(opt);
      }
    }
  } catch {
    // Fallback: try getting just current project
    try {
      const res = await fetch(`${API_URL}/project`, { method: "GET" });
      const data = await res.json();
      if (data.ok && data.path) {
        const name = data.path.split("/").pop() || data.path;
        projectSelect.innerHTML = `<option value="${data.path}">${name}</option>`;
      }
    } catch {
      projectSelect.innerHTML = '<option value="">No projects</option>';
    }
  }
}

// Extract content from current tab
async function extractContent() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    pageUrl = tab.url || "";
    titleInput.value = tab.title || "Untitled";
    urlPreview.textContent = pageUrl;

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const selectors = [
          "article",
          '[role="main"]',
          "main",
          ".post-content",
          ".article-content",
          ".entry-content",
          "#content",
          ".content",
        ];

        let article = null;
        for (const sel of selectors) {
          article = document.querySelector(sel);
          if (article) break;
        }
        if (!article) article = document.body;

        const clone = article.cloneNode(true);
        const removeSelectors = [
          "script", "style", "nav", "header", "footer",
          ".sidebar", ".nav", ".menu", ".ad", ".advertisement",
          ".comments", ".comment", "#comments", ".social-share",
          ".related-posts", ".newsletter", "[role='navigation']",
        ];
        for (const sel of removeSelectors) {
          clone.querySelectorAll(sel).forEach((el) => el.remove());
        }

        function nodeToText(node) {
          if (node.nodeType === Node.TEXT_NODE) return node.textContent.trim();
          if (node.nodeType !== Node.ELEMENT_NODE) return "";

          const tag = node.tagName.toLowerCase();
          const children = Array.from(node.childNodes).map((c) => nodeToText(c)).filter((t) => t).join(" ");
          if (!children.trim()) return "";

          switch (tag) {
            case "h1": return `\n\n# ${children}\n\n`;
            case "h2": return `\n\n## ${children}\n\n`;
            case "h3": return `\n\n### ${children}\n\n`;
            case "h4": return `\n\n#### ${children}\n\n`;
            case "p": return `\n\n${children}\n\n`;
            case "li": return `\n- ${children}`;
            case "ul": case "ol": return `\n${children}\n`;
            case "blockquote": return `\n\n> ${children}\n\n`;
            case "pre": case "code": return `\n\n\`\`\`\n${children}\n\`\`\`\n\n`;
            case "strong": case "b": return `**${children}**`;
            case "em": case "i": return `*${children}*`;
            case "a": return `[${children}](${node.getAttribute("href") || ""})`;
            case "img": return `\n\n![${node.getAttribute("alt") || "image"}](${node.getAttribute("src") || ""})\n\n`;
            case "br": return "\n";
            case "hr": return "\n\n---\n\n";
            case "tr": return `| ${children} |\n`;
            case "th": case "td": return ` ${children} |`;
            default: return children;
          }
        }

        let text = nodeToText(clone);
        text = text.replace(/\n{3,}/g, "\n\n").trim();
        return text;
      },
    });

    if (results?.[0]?.result) {
      extractedContent = results[0].result;
      const preview = extractedContent.slice(0, 200);
      contentPreview.textContent = preview + (extractedContent.length > 200 ? "..." : "");
      clipBtn.disabled = false;
    } else {
      contentPreview.textContent = "Failed to extract content";
    }
  } catch (err) {
    contentPreview.textContent = `Error: ${err.message}`;
  }
}

// Send clip to selected project
async function sendClip() {
  const selectedProject = projectSelect.value;
  if (!selectedProject) {
    statusBar.className = "status error";
    statusBar.textContent = "✗ Please select a project";
    return;
  }

  clipBtn.disabled = true;
  statusBar.className = "status sending";
  statusBar.textContent = "⏳ Sending to LLM Wiki...";

  try {
    const res = await fetch(`${API_URL}/clip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: titleInput.value,
        url: pageUrl,
        content: extractedContent,
        projectPath: selectedProject,
      }),
    });

    const data = await res.json();

    if (data.ok) {
      const projectName = projectSelect.options[projectSelect.selectedIndex]?.textContent || "project";
      statusBar.className = "status success";
      statusBar.textContent = `✓ Saved to ${projectName}`;
      clipBtn.textContent = "✓ Clipped!";
      clipBtn.disabled = true;
    } else {
      statusBar.className = "status error";
      statusBar.textContent = `✗ Error: ${data.error}`;
      clipBtn.disabled = false;
    }
  } catch (err) {
    statusBar.className = "status error";
    statusBar.textContent = `✗ Connection failed: ${err.message}`;
    clipBtn.disabled = false;
  }
}

clipBtn.addEventListener("click", sendClip);

// Initialize
(async () => {
  const connected = await checkConnection();
  if (connected) {
    await extractContent();
  }
})();
