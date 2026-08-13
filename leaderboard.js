(() => {
  "use strict";

  const SUPABASE_URL = "https://atdqvkkpnupphxrdoawq.supabase.co";
  const PUBLISHABLE_KEY = "sb_publishable_lZGnDkxBcFxOOVeJziTGjQ_UrI7FuzV";
  const FALLBACK_IMAGES = [
    { image_key: "speaki", image_title: "Speaki" },
    { image_key: "furina", image_title: "Furina" },
    { image_key: "doro-doro-dororong", image_title: "DoroDoroDororong" },
    { image_key: "jjiho", image_title: "Jjiho" },
    { image_key: "twiing", image_title: "Twiing" },
  ];

  const hall = document.querySelector("[data-hall-of-fame]");
  const hallStatus = document.querySelector("[data-hall-status]");
  const hallTable = document.querySelector("[data-hall-table]");
  const hallBody = document.querySelector("[data-hall-body]");
  const imageList = document.querySelector("[data-image-ranking-list]");
  const rankingPeriod = document.querySelector("[data-image-ranking-period]");
  if (!hall || !hallStatus || !hallTable || !hallBody || !imageList || !rankingPeriod) return;

  async function parseResponse(response) {
    const text = await response.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return { message: text }; }
  }

  async function callRpc(name, body = {}) {
    let response;
    try {
      response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error("Could not reach the leaderboard.");
    }
    const payload = await parseResponse(response);
    if (!response.ok) {
      const unavailable = response.status === 404 || payload?.code === "PGRST202";
      throw new Error(unavailable ? "The leaderboard has not been activated yet." : payload?.message || "Could not load scores.");
    }
    return Array.isArray(payload) ? payload : [];
  }

  function safeEmail(value) {
    const email = String(value || "").trim().toLowerCase();
    return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email) ? email : "";
  }

  function rankingAnchor(imageKey) {
    return `ranking-${String(imageKey || "").replace(/[^a-z0-9-]/gi, "-")}`;
  }

  function openRankingFromHash() {
    const targetId = decodeURIComponent(window.location.hash.slice(1));
    const target = targetId ? document.getElementById(targetId) : null;
    if (target instanceof HTMLDetailsElement) target.open = true;
  }

  function kstCalendarToday() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    return Object.fromEntries(parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]));
  }

  function fallbackRankingPeriod() {
    const today = kstCalendarToday();
    const daysInStartMonth = new Date(Date.UTC(today.year - 1, today.month, 0)).getUTCDate();
    const startDay = Math.min(today.day, daysInStartMonth);
    return {
      period_start: `${today.year - 1}-${String(today.month).padStart(2, "0")}-${String(startDay).padStart(2, "0")}`,
      period_end: `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`,
      time_zone: "Asia/Seoul",
    };
  }

  function formatCalendarDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) return "";
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(date);
  }

  function renderRankingPeriod(period = fallbackRankingPeriod()) {
    const from = formatCalendarDate(period.period_start);
    const to = formatCalendarDate(period.period_end);
    if (!from || !to) return;
    rankingPeriod.textContent = `(${from} ~ ${to}, KST)`;
    rankingPeriod.setAttribute("aria-label", `Ranking period: ${from} through ${to}, Korea Standard Time`);
  }

  async function loadRankingPeriod() {
    renderRankingPeriod();
    try {
      const [period] = await callRpc("get_puzzle_ranking_period");
      if (period?.time_zone === "Asia/Seoul") renderRankingPeriod(period);
    } catch { /* KST browser calculation remains visible while the API is unavailable */ }
  }

  function rankCell(place) {
    const cell = document.createElement("td");
    cell.className = "leaderboard-place";
    cell.textContent = `#${Number(place) || "–"}`;
    return cell;
  }

  function nameCell(entry) {
    const cell = document.createElement("td");
    const name = String(entry.player_name || "Player");
    const email = safeEmail(entry.contact_email);
    if (email) {
      const link = document.createElement("a");
      const mailAddress = encodeURIComponent(email).replace(/%40/gi, "@");
      link.href = `mailto:${mailAddress}`;
      link.textContent = name;
      link.setAttribute("aria-label", `Email ${name}`);
      cell.append(link);
    } else cell.textContent = name;
    if (entry.is_you) {
      const marker = document.createElement("span");
      marker.className = "leaderboard-you";
      marker.textContent = " (you)";
      cell.append(marker);
    }
    return cell;
  }

  function textCell(text, className = "") {
    const cell = document.createElement("td");
    cell.textContent = text;
    if (className) cell.className = className;
    return cell;
  }

  function dateCell(value) {
    const cell = document.createElement("td");
    cell.className = "leaderboard-date";
    const dateValue = String(value || "");
    const formatted = formatCalendarDate(dateValue);
    if (!formatted) {
      cell.textContent = "—";
      return cell;
    }
    const time = document.createElement("time");
    time.dateTime = dateValue;
    time.textContent = formatted;
    cell.append(time);
    return cell;
  }

  function renderRows(body, rows, includeImage) {
    body.replaceChildren();
    rows.forEach((entry, index) => {
      const row = document.createElement("tr");
      if (entry.is_you) row.classList.add("is-you");
      if (index < 3) row.classList.add(`place-${index + 1}`);
      row.append(rankCell(entry.place), nameCell(entry));
      if (includeImage) {
        const imageCell = document.createElement("td");
        const imageLink = document.createElement("a");
        imageLink.href = `#${rankingAnchor(entry.image_key)}`;
        imageLink.textContent = String(entry.image_title || "Puzzle image");
        imageLink.addEventListener("click", () => {
          const target = document.getElementById(rankingAnchor(entry.image_key));
          if (target instanceof HTMLDetailsElement) target.open = true;
        });
        imageCell.append(imageLink);
        row.append(imageCell);
      }
      row.append(textCell(String(Number(entry.moves) || 0), "leaderboard-moves"));
      row.append(dateCell(entry.registered_on));
      body.append(row);
    });
  }

  function createImageSection(image) {
    const section = document.createElement("details");
    section.className = "image-ranking";
    section.id = rankingAnchor(image.image_key);
    section.setAttribute("aria-labelledby", `${section.id}-title`);

    const summary = document.createElement("summary");
    summary.className = "image-ranking-summary";
    const heading = document.createElement("span");
    heading.id = `${section.id}-title`;
    heading.className = "image-ranking-title";
    heading.setAttribute("role", "heading");
    heading.setAttribute("aria-level", "4");
    heading.textContent = image.image_title;
    const summaryHint = document.createElement("span");
    summaryHint.className = "image-ranking-summary-hint";
    summaryHint.textContent = "Show or hide";
    summary.append(heading, summaryHint);
    const panel = document.createElement("div");
    panel.className = "image-ranking-panel";
    const status = document.createElement("p");
    status.className = "leaderboard-page-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = "Loading scores…";
    const wrap = document.createElement("div");
    wrap.className = "leaderboard-page-table-wrap";
    const table = document.createElement("table");
    table.className = "leaderboard-page-table leaderboard-image-table";
    table.hidden = true;
    const caption = document.createElement("caption");
    caption.className = "visually-hidden";
    caption.textContent = `${image.image_title} sliding puzzle leaderboard`;
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["Rank", "Name", "Moves", "Registered (KST)"].forEach((label) => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = label;
      headRow.append(cell);
    });
    head.append(headRow);
    const body = document.createElement("tbody");
    table.append(caption, head, body);
    wrap.append(table);
    panel.append(status, wrap);
    section.append(summary, panel);
    return { section, status, table, body };
  }

  async function loadHall() {
    try {
      const rows = await callRpc("get_puzzle_hall_of_fame");
      renderRows(hallBody, rows, true);
      hallTable.hidden = !rows.length;
      hallStatus.textContent = rows.length ? "" : "No Hall of Fame records yet.";
    } catch (error) {
      hallStatus.textContent = error.message;
    } finally {
      hall.setAttribute("aria-busy", "false");
    }
  }

  async function loadImageRanking(image, view) {
    try {
      const rows = await callRpc("get_puzzle_leaderboard", { p_image_key: image.image_key, p_limit: 100 });
      renderRows(view.body, rows, false);
      view.table.hidden = !rows.length;
      view.status.textContent = rows.length ? "" : "No scores yet.";
    } catch (error) {
      view.status.textContent = error.message;
    }
  }

  async function initialize() {
    void loadHall();
    void loadRankingPeriod();
    let images = FALLBACK_IMAGES;
    try {
      const catalog = await callRpc("get_puzzle_leaderboard_catalog");
      if (catalog.length) images = catalog;
    } catch { /* fallback keeps every known public image visible */ }
    const jobs = images.map((image) => {
      const view = createImageSection(image);
      imageList.append(view.section);
      return loadImageRanking(image, view);
    });
    openRankingFromHash();
    await Promise.allSettled(jobs);
    imageList.setAttribute("aria-busy", "false");
  }

  window.addEventListener("hashchange", openRankingFromHash);
  void initialize();
})();
