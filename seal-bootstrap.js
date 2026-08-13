(() => {
  "use strict";

  const script = document.currentScript;
  const card = script?.parentElement;
  const button = card?.querySelector(":scope > .card-seal");
  if (!card?.classList.contains("message-card") || !button) {
    return;
  }

  const stateKey = "jiwon-seal-state-v1";
  const zzzEpochKey = "jiwon-seal-zzz-epoch-v1";
  const states = new Set([
    "sleeping",
    "startled",
    "confused",
    "crawling",
    "settling",
  ]);
  const now = Date.now();
  const slotCount = 5;
  const startleDuration = 950;
  const confusedDuration = 1800;
  const legacyCrawlDuration = 2000;
  const maximumCrawlDuration = 8000;
  const settlingDuration = 160;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const validPlan = (fromSlot, toSlot) => (
    Number.isInteger(fromSlot) &&
    fromSlot >= 0 &&
    fromSlot < slotCount &&
    Number.isInteger(toSlot) &&
    toSlot >= 0 &&
    toSlot < slotCount &&
    fromSlot !== toSlot
  );
  const cubicCoordinate = (time, firstControl, secondControl) => {
    const inverse = 1 - time;
    return 3 * inverse * inverse * time * firstControl +
      3 * inverse * time * time * secondControl +
      time * time * time;
  };
  const crawlEase = (progress) => {
    let lower = 0;
    let upper = 1;
    let time = progress;
    for (let iteration = 0; iteration < 12; iteration += 1) {
      const position = cubicCoordinate(time, 0.45, 0.55);
      if (Math.abs(position - progress) < 0.0001) {
        break;
      }
      if (position < progress) {
        lower = time;
      } else {
        upper = time;
      }
      time = (lower + upper) / 2;
    }
    return cubicCoordinate(time, 0.05, 0.95);
  };

  let snapshot;
  try {
    snapshot = JSON.parse(window.sessionStorage.getItem(stateKey) || "null");
  } catch {
    return;
  }

  if (
    !snapshot ||
    snapshot.version !== 1 ||
    !Number.isInteger(snapshot.slot) ||
    snapshot.slot < 0 ||
    snapshot.slot >= slotCount ||
    typeof snapshot.facingRight !== "boolean" ||
    !states.has(snapshot.state) ||
    !Number.isFinite(snapshot.deadline) ||
    (
      snapshot.duration !== null &&
      snapshot.duration !== undefined &&
      (
        !Number.isFinite(snapshot.duration) ||
        snapshot.duration <= 0 ||
        snapshot.duration > maximumCrawlDuration
      )
    ) ||
    !Number.isFinite(snapshot.updatedAt) ||
    snapshot.updatedAt > now + 60 * 1000 ||
    now - snapshot.updatedAt > 24 * 60 * 60 * 1000 ||
    (
      snapshot.state !== "sleeping" &&
      !validPlan(snapshot.fromSlot, snapshot.toSlot)
    )
  ) {
    return;
  }

  const crawlDuration = Number.isFinite(snapshot.duration)
    ? snapshot.duration
    : legacyCrawlDuration;
  const effectiveCrawlDuration = reducedMotion ? 0 : crawlDuration;
  let state = snapshot.state;
  let deadline = snapshot.deadline;
  let crossedCrawl = false;

  while (state !== "sleeping" && deadline <= now) {
    if (state === "startled") {
      state = "confused";
      deadline += confusedDuration;
    } else if (state === "confused") {
      state = "crawling";
      deadline += effectiveCrawlDuration;
    } else if (state === "crawling") {
      crossedCrawl = true;
      state = "settling";
      deadline += reducedMotion ? 0 : settlingDuration;
    } else {
      state = "sleeping";
      deadline = 0;
    }
  }

  let slot = snapshot.slot;
  if (state === "crawling" && validPlan(snapshot.fromSlot, snapshot.toSlot)) {
    slot = snapshot.fromSlot;
  } else if (crossedCrawl && validPlan(snapshot.fromSlot, snapshot.toSlot)) {
    slot = snapshot.toSlot;
  }

  button.className = `card-seal card-seal--${state} card-seal--slot-${slot}${
    state === "crawling" ? " card-seal--waapi-crawl" : ""
  }`;
  const facing = button.querySelector(".card-seal__facing");
  const facingRight = (
    (state === "crawling" || crossedCrawl) &&
    validPlan(snapshot.fromSlot, snapshot.toSlot)
  )
    ? snapshot.toSlot > snapshot.fromSlot
    : snapshot.facingRight;
  facing?.classList.toggle("card-seal__facing--right", facingRight);
  const alert = button.querySelector(".card-seal__alert");
  if (alert) {
    alert.textContent = state === "confused" ? "??" : "!";
  }

  if (state === "startled" || state === "confused") {
    const duration = state === "startled" ? startleDuration : confusedDuration;
    const elapsed = duration - Math.max(0, Math.min(duration, deadline - now));
    button.style.setProperty("--seal-phase-delay", `${-elapsed}ms`);
  }

  if (state === "crawling" && validPlan(snapshot.fromSlot, snapshot.toSlot)) {
    const startedAt = Number.isFinite(snapshot.startedAt)
      ? snapshot.startedAt
      : deadline - crawlDuration;
    const elapsed = Math.max(0, Math.min(crawlDuration, now - startedAt));
    const progress = crawlEase(crawlDuration > 0 ? elapsed / crawlDuration : 1);
    const visualSlot = snapshot.fromSlot +
      (snapshot.toSlot - snapshot.fromSlot) * progress;
    const trackRatio = visualSlot / (slotCount - 1);
    button.style.left = `calc(${trackRatio * 100}% - ${trackRatio * 5.4}rem)`;
    button.dataset.sealBootstrapCrawl = "true";
    button.style.setProperty(
      "--seal-crawl-cycle-delay",
      `${-(elapsed % 620)}ms`,
    );
  }

  if (state === "sleeping") {
    let startedAt = null;
    try {
      const epoch = JSON.parse(window.sessionStorage.getItem(zzzEpochKey) || "null");
      if (
        epoch?.version === 1 &&
        Number.isSafeInteger(epoch.startedAt) &&
        epoch.startedAt > 0 &&
        epoch.startedAt <= now + 60 * 1000
      ) {
        startedAt = epoch.startedAt;
      }
      if (startedAt === null) {
        startedAt = now;
        window.sessionStorage.setItem(zzzEpochKey, JSON.stringify({
          version: 1,
          startedAt,
        }));
      }
    } catch {
      startedAt = now;
    }
    const zzzPhase = ((now - startedAt) % 2300 + 2300) % 2300;
    const sleepyPhase = ((now - startedAt) % 2400 + 2400) % 2400;
    button.querySelector(".card-seal__zzz")?.style.setProperty(
      "--seal-zzz-delay",
      `${-zzzPhase}ms`,
    );
    button.style.setProperty("--seal-sleep-delay", `${-sleepyPhase}ms`);
  }
})();
