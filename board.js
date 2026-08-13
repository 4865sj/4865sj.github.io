(() => {
  "use strict";

  const SUPABASE_URL = "https://atdqvkkpnupphxrdoawq.supabase.co";
  const PUBLISHABLE_KEY = "sb_publishable_lZGnDkxBcFxOOVeJziTGjQ_UrI7FuzV";
  const SESSION_KEY = "jiwon-board-session-v1";
  const PKCE_KEY = "jiwon-board-pkce-v1";
  const PENDING_KEY = "jiwon-board-pending-v1";
  const DRAFT_KEY = "jiwon-board-draft-v1";
  const SEAL_STATE_KEY = "jiwon-seal-state-v1";
  const SEAL_ZZZ_EPOCH_KEY = "jiwon-seal-zzz-epoch-v1";
  const TITLE_CREPE_STATE_KEY = "jiwon-title-crepe-state-v1";
  const IMAGE_INTENT_KEY = "jiwon-board-image-intent-v1";
  const IMAGE_CLEANUP_KEY = "jiwon-board-image-cleanup-v1";
  const MESSAGE_LIMIT = 2000;
  const AUTHOR_NAME_LIMIT = 40;
  const INTENT_TTL_MS = 5 * 60 * 1000;
  const REFRESH_MARGIN_MS = 60 * 1000;
  const BOARD_REFRESH_MS = 45 * 1000;
  const IMAGE_BUCKET = "board-images";
  const IMAGE_LIMIT = 5 * 1024 * 1024;
  const IMAGE_PIXEL_LIMIT = 40 * 1000 * 1000;
  const IMAGE_SIDE_LIMIT = 12000;
  const IMAGE_TYPES = new Map([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
  ]);
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const IMAGE_PATH_PATTERN = /^requests\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i;

  let currentSession = null;
  let sessionRevision = 0;
  let refreshPromise = null;
  let boardLoadPromise = null;
  let lastBoardLoad = 0;
  let signInStarting = false;
  let authCallbackInProgress = ["code", "error", "error_code", "error_description"]
    .some((name) => new URL(window.location.href).searchParams.has(name));
  let topLevelSubmitPromise = null;
  let topLevelRequest = { body: "", authorName: "", id: "" };
  let selectedImage = null;
  let selectedImagePreviewUrl = "";
  let imageSelectionRevision = 0;
  let imageSelectionPromise = null;
  let unresolvedImageIntent = null;
  let imageRecoveryPromise = null;
  const replySubmitPromises = new Map();
  const replyDrafts = new Map();
  const messageMutationPromises = new Map();
  let boardPermissions = new Map();
  let boardPermissionWarning = "";

  const boardList = document.querySelector("[data-board-list]");
  const isBoardPage = Boolean(boardList);

  function initializeTitleCrepe() {
    const panel = document.querySelector(".title-panel");
    const container = panel?.querySelector(":scope > .container");
    if (!panel || !container || panel.dataset.crepeReady === "true") {
      return;
    }

    panel.dataset.crepeReady = "true";

    const track = document.createElement("div");
    track.id = "title-crepe-character";
    track.className = "title-crepe-track";
    track.setAttribute("aria-hidden", "true");

    const crepe = document.createElement("span");
    crepe.className = "title-crepe title-crepe--looking title-crepe--slot-4";

    const anchor = document.createElement("span");
    anchor.className = "title-crepe__anchor";

    const facing = document.createElement("span");
    facing.className = "title-crepe__facing";

    const image = document.createElement("img");
    image.className = "title-crepe__image";
    image.src = "assets/crepe-frames/idle-00.png";
    image.alt = "";
    image.width = 207;
    image.height = 252;
    image.decoding = "async";
    image.draggable = false;
    image.addEventListener("error", () => {
      if (!image.src.endsWith("/assets/crepe.png")) {
        image.src = "assets/crepe.png";
      } else {
        image.hidden = true;
      }
    });

    const dusterHead = document.createElement("span");
    dusterHead.className = "title-crepe__duster-head";
    dusterHead.hidden = true;

    const dusterMask = document.createElement("span");
    dusterMask.className = "title-crepe__duster-mask";
    dusterMask.hidden = true;

    facing.append(image, dusterMask, dusterHead);
    anchor.append(facing);
    crepe.append(anchor);
    track.append(crepe);
    container.append(track);

    const control = document.createElement("button");
    control.className = "title-crepe-control";
    control.type = "button";
    control.textContent = "Hide character";
    control.setAttribute("aria-controls", track.id);
    control.setAttribute("aria-pressed", "false");
    const controlHost = document.querySelector(".message-card-content") ||
      document.querySelector(".message-card");
    (controlHost || container).append(control);

    const slotCount = 5;
    const frameNames = (prefix, count) => Array.from(
      { length: count },
      (_, index) => `${prefix}-${String(index).padStart(2, "0")}`,
    );
    const walkFrames = [
      "walk-00", "walk-01", "walk-02", "walk-03", "walk-04", "walk-06",
      "walk-09", "walk-06", "walk-04", "walk-03", "walk-02", "walk-01",
    ];
    const cleanFrames = [
      "clean-00", "clean-01", "clean-02", "clean-03",
      "clean-05", "clean-06", "clean-07", "clean-08", "clean-09",
      "clean-10", "clean-12",
      "clean-13", "clean-14", "clean-15", "clean-00",
    ];
    const idleFrames = [
      "idle-00", "idle-02", "idle-07", "idle-03", "idle-04",
      "idle-05", "idle-06", "idle-07", "idle-08",
      "idle-10", "idle-08", "idle-07", "idle-02", "idle-00",
    ];
    const walkFrameDuration = 150;
    const cleanFrameDuration = 125;
    const idleFrameDuration = 250;
    const dusterHeadPoses = {
      "walk-00": [9.1, 49.6, 64.5, 26.1, 11.9],
      "walk-01": [12.2, 54.3, 57, 26.6, 11.1],
      "walk-02": [9, 55.1, 52.3, 25.1, 11.5],
      "walk-03": [9.5, 56.6, 65.2, 23.5, 10.7],
      "walk-04": [10, 63, 38.7, 24.2, 11.5],
      "walk-06": [8.5, 72.9, -34.5, 25.5, 11.9],
      "walk-09": [8.8, 73, -36.2, 25.5, 11.9],
    };
    const framePaths = [...new Set([...walkFrames, ...cleanFrames, ...idleFrames])].reduce(
      (paths, frame) => ({
        ...paths,
        [frame]: `assets/crepe-frames/${frame}.png`,
      }),
      {},
    );
    const slotClasses = Array.from(
      { length: slotCount },
      (_, slot) => `title-crepe--slot-${slot}`,
    );
    const stateClasses = [
      "title-crepe--moving",
      "title-crepe--cleaning",
      "title-crepe--looking",
      "title-crepe--paused",
    ];
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const timers = new Set();
    let generation = 0;
    let currentSlot = 4;
    let currentState = "looking";
    let currentFrame = "idle-00";
    let phaseDeadline = 0;
    let phaseStartedAt = 0;
    let phaseDuration = 0;
    let phaseFromSlot = null;
    let phaseToSlot = null;
    let paused = false;
    let movement = null;
    let frameAnimation = null;
    let resizeTimer = null;
    let movementStartedAt = 0;
    let movementDuration = 0;
    let ready = false;

    const frameImages = new Map();
    const preloadOrder = [...idleFrames, ...walkFrames, ...cleanFrames];
    const decodePromises = preloadOrder.map((frame) => {
      const source = framePaths[frame];
      const preload = new Image();
      preload.src = source;
      frameImages.set(frame, preload);
      return preload.decode?.().catch(() => {}) || Promise.resolve();
    });
    const initialFramesReady = Promise.allSettled(
      decodePromises.slice(0, idleFrames.length),
    );

    const clearTimers = () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
      if (frameAnimation !== null) {
        window.cancelAnimationFrame(frameAnimation);
        frameAnimation = null;
      }
      if (resizeTimer !== null) {
        window.clearTimeout(resizeTimer);
        resizeTimer = null;
      }
    };

    const stopFrames = () => {
      if (frameAnimation !== null) {
        window.cancelAnimationFrame(frameAnimation);
        frameAnimation = null;
      }
    };

    const stopMovement = () => {
      if (resizeTimer !== null) {
        window.clearTimeout(resizeTimer);
        resizeTimer = null;
      }
      movement?.cancel();
      movement = null;
      movementStartedAt = 0;
      movementDuration = 0;
      crepe.classList.remove("title-crepe--waapi");
    };

    const schedule = (callback, delay) => {
      const activeGeneration = generation;
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        if (activeGeneration === generation) {
          callback();
        }
      }, delay);
      timers.add(timer);
    };

    const setState = (state) => {
      crepe.classList.remove(...stateClasses);
      crepe.classList.add(`title-crepe--${state}`);
      currentState = state;
    };

    const setSlot = (slot) => {
      crepe.classList.remove(...slotClasses);
      crepe.classList.add(`title-crepe--slot-${slot}`);
      currentSlot = slot;
    };

    const setFrame = (frame) => {
      const frameImage = frameImages.get(frame);
      if (!frameImage) {
        return;
      }
      currentFrame = frame;
      image.hidden = false;
      if (image.getAttribute("src") !== frameImage.src) {
        image.src = frameImage.src;
      }
      const headPose = dusterHeadPoses[frame];
      dusterMask.hidden = !headPose;
      dusterHead.hidden = !headPose;
      if (headPose) {
        const [x, y, angle, width, height] = headPose;
        [dusterMask, dusterHead].forEach((element) => {
          element.style.setProperty("--duster-x", `${x}%`);
          element.style.setProperty("--duster-y", `${y}%`);
          element.style.setProperty("--duster-angle", `${angle}deg`);
          element.style.setProperty("--duster-width", `${width}%`);
          element.style.setProperty("--duster-height", `${height}%`);
        });
      }
    };

    const startFrames = (frames, duration, offset = 0) => {
      stopFrames();
      const startedAt = window.performance.now() - Math.max(0, offset);
      let visibleIndex = -1;
      const renderFrame = (now) => {
        const index = Math.floor((now - startedAt) / duration) % frames.length;
        if (index !== visibleIndex) {
          visibleIndex = index;
          setFrame(frames[index]);
        }
        frameAnimation = window.requestAnimationFrame(renderFrame);
      };
      frameAnimation = window.requestAnimationFrame(renderFrame);
    };

    const readState = () => {
      try {
        const value = JSON.parse(
          window.sessionStorage.getItem(TITLE_CREPE_STATE_KEY) || "null",
        );
        if (
          !value ||
          value.version !== 7 ||
          !["moving", "cleaning", "looking", "paused"].includes(value.state) ||
          !Number.isInteger(value.slot) ||
          value.slot < 0 ||
          value.slot >= slotCount ||
          typeof value.facingRight !== "boolean" ||
          typeof value.paused !== "boolean" ||
          !Number.isFinite(value.deadline) ||
          !Number.isFinite(value.phaseStartedAt) ||
          !Number.isFinite(value.phaseDuration) ||
          !Number.isFinite(value.updatedAt) ||
          value.updatedAt > Date.now() + 60 * 1000 ||
          Date.now() - value.updatedAt > 24 * 60 * 60 * 1000 ||
          (
            value.state === "moving" &&
            (
              !Number.isInteger(value.fromSlot) ||
              !Number.isInteger(value.toSlot) ||
              value.fromSlot < 0 ||
              value.fromSlot >= slotCount ||
              value.toSlot < 0 ||
              value.toSlot >= slotCount ||
              value.fromSlot === value.toSlot
            )
          )
        ) {
          return null;
        }
        return value;
      } catch {
        return null;
      }
    };

    const saveState = () => {
      try {
        window.sessionStorage.setItem(TITLE_CREPE_STATE_KEY, JSON.stringify({
          version: 7,
          state: currentState,
          slot: currentSlot,
          facingRight: facing.classList.contains("title-crepe__facing--right"),
          deadline: phaseDeadline,
          phaseStartedAt,
          fromSlot: phaseFromSlot,
          toSlot: phaseToSlot,
          phaseDuration,
          frame: currentFrame,
          paused,
          updatedAt: Date.now(),
        }));
      } catch {
        // The decorative animation can restart if session storage is unavailable.
      }
    };

    const chooseNextSlot = () => {
      const candidates = Array.from(
        { length: slotCount },
        (_, slot) => slot,
      ).filter((slot) => slot !== currentSlot && Math.abs(slot - currentSlot) <= 2);
      return candidates[Math.floor(Math.random() * candidates.length)];
    };

    const beginLooking = (
      duration = 2100 + Math.floor(Math.random() * 2100),
      frame,
      elapsed = 0,
    ) => {
      stopMovement();
      setState("looking");
      const safeElapsed = Math.max(0, elapsed);
      if (elapsed > 0) {
        startFrames(idleFrames, idleFrameDuration, elapsed);
      } else if (frame && idleFrames.includes(frame)) {
        startFrames(
          idleFrames,
          idleFrameDuration,
          idleFrames.indexOf(frame) * idleFrameDuration,
        );
      } else {
        startFrames(idleFrames, idleFrameDuration);
      }
      phaseStartedAt = Date.now() - safeElapsed;
      phaseDuration = duration + safeElapsed;
      phaseDeadline = Date.now() + duration;
      phaseFromSlot = null;
      phaseToSlot = null;
      saveState();
      schedule(beginMove, duration);
    };

    const beginCleaning = (duration = 5400, elapsed = 0) => {
      stopMovement();
      setState("cleaning");
      startFrames(cleanFrames, cleanFrameDuration, elapsed);
      phaseStartedAt = Date.now() - elapsed;
      phaseDuration = duration + elapsed;
      phaseDeadline = Date.now() + duration;
      phaseFromSlot = null;
      phaseToSlot = null;
      saveState();
      schedule(() => beginLooking(), duration);
    };

    const beginMove = (
      fromSlot = currentSlot,
      toSlot = chooseNextSlot(),
      remaining = null,
      fullDuration = null,
    ) => {
      stopMovement();
      const distance = Math.abs(toSlot - fromSlot);
      const naturalDuration = distance * 5400;
      const duration = fullDuration || naturalDuration;
      const safeRemaining = Math.min(duration, Math.max(0, remaining ?? duration));
      const elapsed = duration - safeRemaining;
      facing.classList.toggle("title-crepe__facing--right", toSlot > fromSlot);
      setState("moving");
      startFrames(walkFrames, walkFrameDuration, elapsed);
      setSlot(fromSlot);
      void crepe.offsetWidth;
      const fromLeft = anchor.getBoundingClientRect().left;
      setSlot(toSlot);
      const toLeft = anchor.getBoundingClientRect().left;

      if (!reduceMotion.matches && safeRemaining > 0 && typeof anchor.animate === "function") {
        crepe.classList.add("title-crepe--waapi");
        movement = anchor.animate(
          [
            { transform: `translateX(${fromLeft - toLeft}px)` },
            { transform: "translateX(0)" },
          ],
          {
            duration,
            easing: "linear",
          },
        );
        movementStartedAt = Date.now() - elapsed;
        movementDuration = duration;
        if (safeRemaining < duration) {
          movement.pause();
          movement.currentTime = elapsed;
          movement.play();
        }
      }

      phaseStartedAt = Date.now() - elapsed;
      phaseDuration = duration;
      phaseDeadline = Date.now() + safeRemaining;
      phaseFromSlot = fromSlot;
      phaseToSlot = toSlot;
      saveState();
      schedule(() => beginCleaning(), safeRemaining);
    };

    const applyPaused = (shouldPause) => {
      generation += 1;
      clearTimers();
      stopMovement();
      paused = shouldPause;
      crepe.hidden = paused;
      control.textContent = paused ? "Show character" : "Hide character";
      control.setAttribute("aria-pressed", String(paused));
      if (paused) {
        stopFrames();
        setState("paused");
        setFrame("idle-00");
        phaseDeadline = 0;
        phaseStartedAt = 0;
        phaseDuration = 0;
        phaseFromSlot = null;
        phaseToSlot = null;
        saveState();
      } else {
        crepe.hidden = false;
        if (reduceMotion.matches) {
          setState("paused");
          setFrame("idle-00");
          phaseDeadline = 0;
          phaseStartedAt = 0;
          phaseDuration = 0;
          phaseFromSlot = null;
          phaseToSlot = null;
          saveState();
        } else {
          setState("looking");
          beginLooking(1350, "idle-00");
        }
      }
    };

    const resume = () => {
      if (!ready) {
        return;
      }
      generation += 1;
      clearTimers();
      stopMovement();

      const saved = readState();
      if (saved) {
        facing.classList.toggle("title-crepe__facing--right", saved.facingRight);
      }
      if (reduceMotion.matches || document.hidden) {
        const savedSlot = saved?.state === "moving" ? saved.toSlot : saved?.slot;
        setSlot(Number.isInteger(savedSlot) ? savedSlot : currentSlot);
        paused = Boolean(saved?.paused);
        setState("paused");
        setFrame("idle-00");
        crepe.hidden = paused;
        control.textContent = paused ? "Show character" : "Hide character";
        control.setAttribute("aria-pressed", String(paused));
        return;
      }

      if (!saved) {
        crepe.hidden = false;
        setSlot(currentSlot);
        paused = false;
        beginLooking(1500, "idle-00");
        return;
      }

      if (saved.state === "paused" && !saved.paused) {
        setSlot(saved.slot);
        beginLooking(1350, "idle-00");
        return;
      }

      paused = saved.paused;
      crepe.hidden = paused;
      control.textContent = paused ? "Show character" : "Hide character";
      control.setAttribute("aria-pressed", String(paused));
      if (paused) {
        setSlot(saved.slot);
        setState("paused");
        setFrame("idle-00");
        return;
      }

      crepe.hidden = false;

      if (saved.state === "moving" && saved.deadline > Date.now()) {
        const remaining = saved.deadline - Date.now();
        beginMove(saved.fromSlot, saved.toSlot, remaining, saved.phaseDuration);
        return;
      }

      setSlot(saved.state === "moving" ? saved.toSlot : saved.slot);
      if (saved.state === "cleaning" && saved.deadline > Date.now()) {
        beginCleaning(
          saved.deadline - Date.now(),
          Math.max(0, Date.now() - saved.phaseStartedAt),
        );
      } else if (saved.state === "looking" && saved.deadline > Date.now()) {
        beginLooking(
          saved.deadline - Date.now(),
          saved.frame,
          Math.max(0, Date.now() - saved.phaseStartedAt),
        );
      } else if (saved.state === "moving") {
        beginCleaning();
      } else if (saved.state === "looking") {
        beginMove();
      } else {
        beginLooking(1500);
      }
    };

    control.addEventListener("click", () => applyPaused(!paused));

    window.addEventListener("resize", () => {
      if (currentState !== "moving" || paused || reduceMotion.matches) {
        return;
      }
      if (resizeTimer !== null) {
        window.clearTimeout(resizeTimer);
      }
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        if (
          currentState !== "moving" ||
          !movement ||
          movementDuration <= 0 ||
          !Number.isInteger(phaseFromSlot) ||
          !Number.isInteger(phaseToSlot)
        ) {
          return;
        }
        const elapsed = Math.min(
          movementDuration,
          Math.max(0, Date.now() - movementStartedAt),
        );
        const remaining = Math.max(0, movementDuration - elapsed);
        generation += 1;
        clearTimers();
        beginMove(phaseFromSlot, phaseToSlot, remaining, movementDuration);
      }, 120);
    });

    reduceMotion.addEventListener?.("change", resume);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) {
        resume();
      }
    });
    window.addEventListener("pagehide", () => {
      generation += 1;
      clearTimers();
      stopMovement();
    });

    void initialFramesReady.then(() => {
      ready = true;
      resume();
    });
  }

  function initializeSealCompanion() {
    const card = document.querySelector(".message-card");
    if (!card || card.dataset.sealReady === "true") {
      return;
    }

    card.classList.add("seal-enhanced");

    const slotCount = 5;
    const startledDuration = 950;
    const confusedDuration = 1800;
    const zzzDuration = 2300;
    const sleepyDuration = 2400;
    const crawlCycleDuration = 620;
    const crawlDurationPerSlot = 2000;
    const maximumCrawlDuration = (slotCount - 1) * crawlDurationPerSlot;
    const legacyCrawlDuration = 2000;
    const sealStates = new Set([
      "sleeping",
      "startled",
      "confused",
      "crawling",
      "settling",
    ]);
    const slotClasses = Array.from(
      { length: slotCount },
      (_, slot) => `card-seal--slot-${slot}`,
    );
    const crawlDurationForSlots = (fromSlot, toSlot) => (
      Math.abs(toSlot - fromSlot) * crawlDurationPerSlot
    );
    const readSealState = () => {
      try {
        const value = JSON.parse(window.sessionStorage.getItem(SEAL_STATE_KEY) || "null");
        if (
          !value ||
          value.version !== 1 ||
          !Number.isInteger(value.slot) ||
          value.slot < 0 ||
          value.slot > 4 ||
          typeof value.facingRight !== "boolean" ||
          !sealStates.has(value.state) ||
          !Number.isFinite(value.deadline) ||
          (
            value.duration !== null &&
            value.duration !== undefined &&
            (
              !Number.isFinite(value.duration) ||
              value.duration <= 0 ||
              value.duration > maximumCrawlDuration
            )
          ) ||
          !Number.isFinite(value.updatedAt) ||
          value.updatedAt > Date.now() + 60 * 1000 ||
          Date.now() - value.updatedAt > 24 * 60 * 60 * 1000 ||
          (
            value.state !== "sleeping" &&
            !(
              Number.isInteger(value.fromSlot) &&
              value.fromSlot >= 0 &&
              value.fromSlot <= 4 &&
              Number.isInteger(value.toSlot) &&
              value.toSlot >= 0 &&
              value.toSlot <= 4 &&
              value.fromSlot !== value.toSlot
            )
          )
        ) {
          return null;
        }
        return value;
      } catch {
        return null;
      }
    };
    const storedSealState = readSealState();
    const initialSlot = storedSealState?.state === "crawling"
      ? storedSealState.deadline > Date.now()
        ? storedSealState.fromSlot
        : storedSealState.toSlot
      : storedSealState?.slot ?? 2;

    const directChild = (selector) => Array.from(card.children).find(
      (child) => child.matches(selector),
    ) || null;

    let button = directChild(".card-seal");
    let content = directChild(".message-card-content");
    let status = directChild(".card-seal-status");

    if (!content) {
      content = document.createElement("div");
      content.className = "message-card-content";
      Array.from(card.childNodes).forEach((child) => {
        if (child !== button && child !== status) {
          content.append(child);
        }
      });
    }

    if (!button) {
      button = document.createElement("button");
    }
    button.style.removeProperty("left");
    button.removeAttribute("data-seal-bootstrap-crawl");
    button.className = `card-seal card-seal--sleeping card-seal--slot-${initialSlot}`;
    button.type = "button";
    button.setAttribute("aria-label", "Wake the sleeping white seal");
    button.removeAttribute("aria-hidden");
    button.removeAttribute("tabindex");

    const zzz = button.querySelector(".card-seal__zzz") || document.createElement("span");
    zzz.className = "card-seal__zzz";
    zzz.textContent = "Zzz…";
    zzz.setAttribute("aria-hidden", "true");

    const alert = button.querySelector(".card-seal__alert") || document.createElement("span");
    alert.className = "card-seal__alert";
    alert.textContent = "!";
    alert.setAttribute("aria-hidden", "true");

    const facing = button.querySelector(".card-seal__facing") || document.createElement("span");
    facing.className = "card-seal__facing";
    facing.setAttribute("aria-hidden", "true");

    const sprite = facing.querySelector(".card-seal__sprite") || document.createElement("span");
    sprite.className = "card-seal__sprite";

    const sleepingArt = sprite.querySelector(".card-seal__art--sleeping") ||
      document.createElement("img");
    sleepingArt.className = "card-seal__art card-seal__art--sleeping";
    sleepingArt.src = "assets/seal-model-v2/sleeping-side.png?v=20260813-3";
    sleepingArt.alt = "";
    sleepingArt.width = 724;
    sleepingArt.height = 543;
    sleepingArt.decoding = "sync";
    sleepingArt.fetchPriority = "high";
    sleepingArt.loading = "eager";
    sleepingArt.draggable = false;

    const awakeArt = sprite.querySelector(".card-seal__art--awake-body") ||
      document.createElement("img");
    awakeArt.className = "card-seal__art card-seal__art--awake card-seal__art--awake-body";
    awakeArt.src = "assets/seal-model-v2/awake-side.png?v=20260813-3";
    awakeArt.alt = "";
    awakeArt.width = 724;
    awakeArt.height = 543;
    awakeArt.decoding = "sync";
    awakeArt.fetchPriority = "high";
    awakeArt.loading = "eager";
    awakeArt.draggable = false;

    const awakeTailArt = sprite.querySelector(".card-seal__art--awake-tail") ||
      document.createElement("img");
    awakeTailArt.className = "card-seal__art card-seal__art--awake card-seal__art--awake-tail";
    awakeTailArt.src = "assets/seal-model-v2/awake-side.png?v=20260813-3";
    awakeTailArt.alt = "";
    awakeTailArt.width = 724;
    awakeTailArt.height = 543;
    awakeTailArt.decoding = "sync";
    awakeTailArt.fetchPriority = "high";
    awakeTailArt.loading = "eager";
    awakeTailArt.draggable = false;

    sprite.replaceChildren(sleepingArt, awakeTailArt, awakeArt);
    facing.replaceChildren(sprite);
    button.replaceChildren(zzz, alert, facing);

    if (!status) {
      status = document.createElement("span");
    }
    status.className = "card-seal-status visually-hidden";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    card.append(button, content, status);
    card.dataset.sealReady = "true";

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const timers = new Set();
    let currentSlot = initialSlot;
    let busy = false;
    let cycleId = 0;
    let crawlAnimation = null;

    let crawlFromSlot = null;
    let crawlToSlot = null;

    const readZzzEpoch = () => {
      try {
        const value = JSON.parse(window.sessionStorage.getItem(SEAL_ZZZ_EPOCH_KEY) || "null");
        return value?.version === 1 && Number.isSafeInteger(value.startedAt) &&
          value.startedAt > 0 && value.startedAt <= Date.now() + 60 * 1000
          ? value.startedAt
          : null;
      } catch {
        return null;
      }
    };

    const writeZzzEpoch = (startedAt) => {
      try {
        window.sessionStorage.setItem(SEAL_ZZZ_EPOCH_KEY, JSON.stringify({
          version: 1,
          startedAt,
        }));
      } catch {
        // The decorative text can restart when storage is unavailable.
      }
    };

    const clearZzzEpoch = () => {
      try {
        window.sessionStorage.removeItem(SEAL_ZZZ_EPOCH_KEY);
      } catch {
        // The decorative text can restart when storage is unavailable.
      }
    };

    const syncZzzPhase = () => {
      let startedAt = readZzzEpoch();
      if (startedAt === null) {
        startedAt = Date.now();
        writeZzzEpoch(startedAt);
      }
      const phase = ((Date.now() - startedAt) % zzzDuration + zzzDuration) % zzzDuration;
      const sleepyPhase = (
        (Date.now() - startedAt) % sleepyDuration + sleepyDuration
      ) % sleepyDuration;
      zzz.style.animation = "none";
      void zzz.offsetWidth;
      zzz.style.setProperty("--seal-zzz-delay", `${-phase}ms`);
      button.style.setProperty("--seal-sleep-delay", `${-sleepyPhase}ms`);
      zzz.style.removeProperty("animation");
    };

    const isValidCrawlPlan = (fromSlot, toSlot) => (
      Number.isInteger(fromSlot) &&
      fromSlot >= 0 &&
      fromSlot < slotCount &&
      Number.isInteger(toSlot) &&
      toSlot >= 0 &&
      toSlot < slotCount &&
      fromSlot !== toSlot
    );

    const saveSealState = (state, deadline = 0, crawlTiming = null) => {
      const preserveCrawlPlan = state !== "sleeping" &&
        isValidCrawlPlan(crawlFromSlot, crawlToSlot);
      try {
        window.sessionStorage.setItem(SEAL_STATE_KEY, JSON.stringify({
          version: 1,
          slot: currentSlot,
          facingRight: facing.classList.contains("card-seal__facing--right"),
          state,
          deadline,
          fromSlot: preserveCrawlPlan ? crawlFromSlot : null,
          toSlot: preserveCrawlPlan ? crawlToSlot : null,
          startedAt: state === "crawling" ? crawlTiming?.startedAt ?? null : null,
          duration: preserveCrawlPlan ? crawlTiming?.duration ?? null : null,
          updatedAt: Date.now(),
        }));
      } catch {
        // Continuity is optional when storage is unavailable.
      }
    };

    const schedule = (callback, delay) => {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        callback();
      }, delay);
      timers.add(timer);
    };

    const setState = (state) => {
      button.classList.remove(
        "card-seal--sleeping",
        "card-seal--startled",
        "card-seal--confused",
        "card-seal--crawling",
        "card-seal--settling",
      );
      button.style.removeProperty("--seal-phase-delay");
      if (state !== "crawling") {
        button.style.removeProperty("--seal-crawl-cycle-delay");
      }
      void button.offsetWidth;
      button.classList.add(`card-seal--${state}`);
    };

    const applyPhaseProgress = (state, remaining) => {
      if (!Number.isFinite(remaining)) {
        return;
      }
      const fullDuration = state === "startled"
        ? startledDuration
        : state === "confused"
          ? confusedDuration
          : 0;
      if (!fullDuration || remaining >= fullDuration) {
        return;
      }
      const elapsed = fullDuration - Math.max(0, remaining);
      button.style.setProperty("--seal-phase-delay", `${-elapsed}ms`);
    };

    const sleep = (persist = true) => {
      crawlAnimation?.cancel();
      crawlAnimation = null;
      button.classList.remove("card-seal--waapi-crawl");
      button.style.removeProperty("--seal-crawl-duration");
      setState("sleeping");
      alert.textContent = "!";
      button.removeAttribute("aria-disabled");
      button.setAttribute("aria-label", "Wake the sleeping white seal");
      syncZzzPhase();
      busy = false;
      if (persist) {
        saveSealState("sleeping");
      }
    };

    const reconcilePhase = (snapshot) => {
      let state = snapshot.state;
      let phaseDeadline = snapshot.deadline;
      let crossedCrawl = false;
      const storedCrawlDuration = Number.isFinite(snapshot.duration)
        ? snapshot.duration
        : legacyCrawlDuration;
      const effectiveCrawlDuration = reduceMotion.matches ? 0 : storedCrawlDuration;
      while (state !== "sleeping" && phaseDeadline <= Date.now()) {
        if (state === "startled") {
          state = "confused";
          phaseDeadline += confusedDuration;
        } else if (state === "confused") {
          state = "crawling";
          phaseDeadline += effectiveCrawlDuration;
        } else if (state === "crawling") {
          crossedCrawl = true;
          state = "settling";
          phaseDeadline += reduceMotion.matches ? 0 : 160;
        } else {
          state = "sleeping";
          phaseDeadline = 0;
        }
      }
      return {
        state,
        remaining: state === "sleeping" ? 0 : phaseDeadline - Date.now(),
        crawlDuration: storedCrawlDuration,
        crossedCrawl,
      };
    };

    const applyCompletedCrawl = (snapshot) => {
      if (isValidCrawlPlan(snapshot.fromSlot, snapshot.toSlot)) {
        facing.classList.toggle(
          "card-seal__facing--right",
          snapshot.toSlot > snapshot.fromSlot,
        );
        currentSlot = snapshot.toSlot;
        return;
      }
      const nextSlot = (
        currentSlot + 1 + Math.floor(Math.random() * (slotCount - 1))
      ) % slotCount;
      facing.classList.toggle("card-seal__facing--right", nextSlot > currentSlot);
      currentSlot = nextSlot;
    };

    const updateSlotClass = () => {
      button.classList.remove(...slotClasses);
      button.classList.add(`card-seal--slot-${currentSlot}`);
    };

    let beginCycle;

    const reconcileSavedState = (snapshot) => {
      currentSlot = snapshot.state === "crawling" &&
        snapshot.deadline > Date.now()
        ? snapshot.fromSlot
        : snapshot.slot;
      facing.classList.toggle("card-seal__facing--right", snapshot.facingRight);
      const restored = reconcilePhase(snapshot);
      if (restored.crossedCrawl && restored.state !== "crawling") {
        applyCompletedCrawl(snapshot);
      }
      updateSlotClass();
      if (restored.state === "sleeping") {
        sleep();
        return;
      }
      beginCycle(restored.state, restored.remaining, snapshot, restored.crawlDuration);
    };

    beginCycle = (
      state = "startled",
      remaining = null,
      snapshot = storedSealState,
      restoredCrawlDuration = null,
    ) => {
      busy = true;
      const activeCycle = ++cycleId;
      const isRestoring = remaining !== null;
      const hasSavedCrawlPlan = isRestoring &&
        snapshot &&
        isValidCrawlPlan(snapshot.fromSlot, snapshot.toSlot);
      if (hasSavedCrawlPlan) {
        crawlFromSlot = snapshot.fromSlot;
        crawlToSlot = snapshot.toSlot;
      } else {
        crawlFromSlot = currentSlot;
        crawlToSlot = (
          currentSlot + 1 + Math.floor(Math.random() * (slotCount - 1))
        ) % slotCount;
      }
      const fullCrawlDuration = Number.isFinite(restoredCrawlDuration)
        ? restoredCrawlDuration
        : isRestoring
          ? Number.isFinite(snapshot?.duration)
            ? snapshot.duration
            : legacyCrawlDuration
          : crawlDurationForSlots(crawlFromSlot, crawlToSlot);
      const startleDelay = state === "startled"
        ? Math.max(0, remaining ?? startledDuration)
        : 0;
      const confusedDelay = state === "confused"
        ? Math.max(0, remaining ?? confusedDuration)
        : confusedDuration;
      const requestedCrawlDelay = state === "crawling"
        ? Math.max(0, remaining ?? fullCrawlDuration)
        : fullCrawlDuration;
      const canAnimateCrawl = typeof button.animate === "function";
      const crawlDelay = reduceMotion.matches
        ? 0
        : Math.min(fullCrawlDuration, requestedCrawlDelay);
      const settleDelay = state === "settling"
        ? Math.max(0, remaining ?? (reduceMotion.matches ? 0 : 160))
        : reduceMotion.matches ? 0 : 160;

      const enterStartled = () => {
        setState("startled");
        if (state === "startled" && remaining !== null) {
          applyPhaseProgress("startled", startleDelay);
        }
        clearZzzEpoch();
        alert.textContent = "!";
        button.setAttribute("aria-disabled", "true");
        button.setAttribute("aria-label", "The white seal is awake");
        saveSealState("startled", Date.now() + startleDelay, {
          duration: fullCrawlDuration,
        });
        schedule(enterConfused, startleDelay);
      };

      const enterConfused = () => {
        if (activeCycle !== cycleId) {
          return;
        }
        setState("confused");
        if (state === "confused" && remaining !== null) {
          applyPhaseProgress("confused", confusedDelay);
        }
        alert.textContent = "??";
        button.setAttribute("aria-disabled", "true");
        button.setAttribute("aria-label", "The white seal is waking up and looks confused");
        saveSealState("confused", Date.now() + confusedDelay, {
          duration: fullCrawlDuration,
        });
        schedule(enterCrawling, confusedDelay);
      };

      const enterCrawling = () => {
        if (activeCycle !== cycleId) {
          return;
        }
        const isRestoredCrawl = state === "crawling" && hasSavedCrawlPlan;
        facing.classList.toggle(
          "card-seal__facing--right",
          crawlToSlot > crawlFromSlot,
        );
        crawlAnimation?.cancel();
        crawlAnimation = null;
        setState("crawling");
        button.classList.remove("card-seal--waapi-crawl");
        button.style.removeProperty("--seal-crawl-duration");
        button.classList.remove(...slotClasses);
        button.classList.add(`card-seal--slot-${crawlFromSlot}`);
        const crawlCycleStartedAt = isRestoredCrawl && Number.isFinite(snapshot.startedAt)
          ? snapshot.startedAt
          : Date.now();
        const crawlCyclePhase = (
          (Date.now() - crawlCycleStartedAt) % crawlCycleDuration + crawlCycleDuration
        ) % crawlCycleDuration;
        button.style.setProperty(
          "--seal-crawl-cycle-delay",
          `${-crawlCyclePhase}ms`,
        );
        void button.offsetWidth;
        const fromLeft = button.getBoundingClientRect().left;
        if (canAnimateCrawl && crawlDelay > 0) {
          button.classList.add("card-seal--waapi-crawl");
          button.classList.remove(`card-seal--slot-${crawlFromSlot}`);
          button.classList.add(`card-seal--slot-${crawlToSlot}`);
          const targetLeft = button.getBoundingClientRect().left;
          const offset = fromLeft - targetLeft;
          crawlAnimation = button.animate(
            [
              { transform: `translateX(${offset}px)` },
              { transform: "translateX(0)" },
            ],
            {
              duration: fullCrawlDuration,
              easing: "cubic-bezier(0.45, 0.05, 0.55, 0.95)",
            },
          );
          if (isRestoredCrawl) {
            crawlAnimation.pause();
            crawlAnimation.currentTime = Math.min(
              fullCrawlDuration,
              Math.max(0, fullCrawlDuration - crawlDelay),
            );
            crawlAnimation.play();
          }
          crawlAnimation.addEventListener("finish", () => {
            crawlAnimation = null;
          }, { once: true });
        } else if (crawlDelay > 0) {
          button.style.setProperty("--seal-crawl-duration", `${crawlDelay}ms`);
          button.classList.remove(`card-seal--slot-${crawlFromSlot}`);
          button.classList.add(`card-seal--slot-${crawlToSlot}`);
        } else {
          button.classList.remove(`card-seal--slot-${crawlFromSlot}`);
          button.classList.add(`card-seal--slot-${crawlToSlot}`);
        }
        currentSlot = crawlToSlot;
        button.setAttribute("aria-disabled", "true");
        button.setAttribute("aria-label", "The white seal is slowly crawling");
        const crawlStartedAt = Date.now();
        saveSealState("crawling", crawlStartedAt + crawlDelay, {
          startedAt: isRestoredCrawl && Number.isFinite(snapshot.startedAt)
            ? snapshot.startedAt
            : crawlStartedAt - (fullCrawlDuration - crawlDelay),
          duration: fullCrawlDuration,
        });
        schedule(enterSettling, crawlDelay);
      };

      const enterSettling = () => {
        if (activeCycle !== cycleId) {
          return;
        }
        crawlAnimation?.cancel();
        crawlAnimation = null;
        button.classList.remove("card-seal--waapi-crawl");
        button.style.removeProperty("--seal-crawl-duration");
        setState("settling");
        saveSealState("settling", Date.now() + settleDelay);
        schedule(() => {
          if (activeCycle === cycleId) {
            sleep();
          }
        }, settleDelay);
      };

      if (state === "confused") {
        enterConfused();
      } else if (state === "crawling") {
        enterCrawling();
      } else if (state === "settling") {
        enterSettling();
      } else {
        enterStartled();
      }
    };

    button.addEventListener("click", () => {
      if (busy) {
        return;
      }

      status.textContent = "The white seal woke up.";
      beginCycle();
    });

    if (storedSealState) {
      reconcileSavedState(storedSealState);
    } else {
      sleep();
    }

    window.addEventListener("pagehide", () => {
      cycleId += 1;
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
      crawlAnimation?.cancel();
      crawlAnimation = null;
    });
    window.addEventListener("pageshow", (event) => {
      if (!event.persisted) {
        return;
      }
      const saved = readSealState();
      if (!saved) {
        cycleId += 1;
        timers.forEach((timer) => window.clearTimeout(timer));
        timers.clear();
        crawlAnimation?.cancel();
        crawlAnimation = null;
        sleep();
        return;
      }
      cycleId += 1;
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
      crawlAnimation?.cancel();
      crawlAnimation = null;
      button.classList.remove("card-seal--waapi-crawl");
      button.style.removeProperty("--seal-crawl-duration");
      reconcileSavedState(saved);
    });

    window.addEventListener("pageshow", (event) => {
      if (!event.persisted || topLevelSubmitPromise) {
        return;
      }
      syncTopLevelDraft(readDraft(), readDraftAuthorName());
    });
  }

  function readStorage(storage, key) {
    try {
      const value = storage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  function writeStorage(storage, key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function removeStorage(storage, key) {
    try {
      storage.removeItem(key);
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
  }

  function normalizeUser(user, previousUser = null) {
    if (!user || typeof user !== "object") {
      return previousUser;
    }

    const metadata = user.user_metadata && typeof user.user_metadata === "object"
      ? user.user_metadata
      : {};
    const displayName = [metadata.full_name, metadata.name, user.email]
      .find((value) => typeof value === "string" && value.trim()) || "Google user";

    return {
      id: typeof user.id === "string" ? user.id : previousUser?.id || "",
      displayName: displayName.trim().slice(0, 80),
    };
  }

  function sessionFromResponse(payload, previousSession = null) {
    if (!payload || typeof payload.access_token !== "string") {
      throw new Error("The sign-in response was incomplete. Please try again.");
    }

    const refreshToken = typeof payload.refresh_token === "string"
      ? payload.refresh_token
      : previousSession?.refreshToken;
    if (!refreshToken) {
      throw new Error("The sign-in response did not include a refresh token.");
    }

    const expiresAtSeconds = Number(payload.expires_at);
    const expiresInSeconds = Number(payload.expires_in);
    const expiresAt = Number.isFinite(expiresAtSeconds) && expiresAtSeconds > 0
      ? expiresAtSeconds * 1000
      : Date.now() + (Number.isFinite(expiresInSeconds) ? expiresInSeconds : 3600) * 1000;

    return {
      accessToken: payload.access_token,
      refreshToken,
      expiresAt,
      user: normalizeUser(payload.user, previousSession?.user || null),
    };
  }

  function readSession() {
    const session = readStorage(window.localStorage, SESSION_KEY);
    if (
      !session ||
      typeof session.accessToken !== "string" ||
      typeof session.refreshToken !== "string" ||
      !Number.isFinite(session.expiresAt)
    ) {
      return null;
    }
    return session;
  }

  function saveSession(session) {
    sessionRevision += 1;
    currentSession = session;
    writeStorage(window.localStorage, SESSION_KEY, session);
    if (!authCallbackInProgress) updateAuthUI();
  }

  function clearSession() {
    sessionRevision += 1;
    currentSession = null;
    removeStorage(window.localStorage, SESSION_KEY);
    if (selectedImage || imageSelectionPromise) {
      clearSelectedImage("Sign in again, then choose the image again.", "error");
    }
    if (!authCallbackInProgress) updateAuthUI();
  }

  async function parseResponse(response) {
    const text = await response.text();
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch {
      return { message: text };
    }
  }

  function responseMessage(response, payload, fallback) {
    const code = payload && typeof payload.code === "string" ? payload.code : "";
    const message = payload && typeof payload.message === "string"
      ? payload.message
      : "";
    if (response.status === 404 || code === "PGRST202" || code === "PGRST205") {
      return "The board has not been initialized yet.";
    }
    if (response.status === 429) {
      return "Too many requests. Please wait a moment and try again.";
    }
    if (message.includes("between 1 and 2000 characters")) {
      return "Enter a message between 1 and 2000 characters.";
    }
    if (message.includes("public name")) {
      return "Use a public name of 1 to 40 characters without an email address, or leave it blank.";
    }
    if (message.includes("verified Google account")) {
      return "Sign in with a verified Google account to post.";
    }
    if (message.includes("Replies must reference")) {
      return "That conversation is no longer available for replies.";
    }
    if (message.includes("Only the author") || message.includes("Only a live published")) {
      return "You no longer have permission to change that message.";
    }
    if (message.includes("no longer exists")) {
      return "That message no longer exists.";
    }
    if (message.includes("wait a few minutes")) {
      return "Please wait a few minutes before posting again.";
    }
    if (message.includes("wait before uploading another image")) {
      return "Please wait before uploading another image.";
    }
    if (message.includes("image upload reservation expired")) {
      return "The image selection expired. Remove it, choose it again, and retry.";
    }
    if (message.includes("Only JPEG, PNG, and WebP")) {
      return "Choose a JPEG, PNG, or WebP image.";
    }
    if (message.includes("uploaded image is missing or invalid")) {
      return "The uploaded image could not be verified. Please choose it again.";
    }
    if (message.includes("Images can only be attached")) {
      return "Images can only be attached to new messages.";
    }
    if (response.status === 401) {
      return "Your sign-in has expired. Please sign in again.";
    }
    if (response.status === 403) {
      return "This account does not have permission to perform that action.";
    }

    return fallback;
  }

  function safeEmail(value) {
    if (typeof value !== "string") {
      return "";
    }
    const email = value.trim().toLowerCase();
    if (
      email.length < 3 ||
      email.length > 320 ||
      /[\u0000-\u0020\u007f-\u009f]/.test(email) ||
      !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)
    ) {
      return "";
    }
    return email;
  }

  function messageRequestError(message, outcomeAmbiguous = false) {
    const error = new Error(message);
    error.postOutcomeAmbiguous = outcomeAmbiguous;
    return error;
  }

  async function refreshSession(session) {
    if (refreshPromise) {
      return refreshPromise;
    }

    const requestedRevision = sessionRevision;
    const requestedRefreshToken = session.refreshToken;

    const performRefresh = async () => {
      const storedSession = readSession();
      if (
        sessionRevision !== requestedRevision ||
        !storedSession ||
        !currentSession
      ) {
        if (storedSession) {
          currentSession = storedSession;
          updateAuthUI();
          return storedSession;
        }
        throw new Error("You signed out while the session was refreshing.");
      }
      const activeSession = storedSession;
      if (
        activeSession.refreshToken !== requestedRefreshToken &&
        activeSession.expiresAt > Date.now() + REFRESH_MARGIN_MS
      ) {
        currentSession = activeSession;
        updateAuthUI();
        return activeSession;
      }

      const revisionAtStart = sessionRevision;
      const refreshTokenAtStart = activeSession.refreshToken;

      let response;
      try {
        response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
          method: "POST",
          headers: {
            apikey: PUBLISHABLE_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ refresh_token: activeSession.refreshToken }),
        });
      } catch {
        throw new Error("Could not reach the sign-in service. Please try again.");
      }

      const payload = await parseResponse(response);
      if (!response.ok) {
        if ([400, 401, 403].includes(response.status)) {
          const latestSession = readSession();
          if (
            latestSession &&
            latestSession.refreshToken !== activeSession.refreshToken
          ) {
            currentSession = latestSession;
            updateAuthUI();
            return latestSession;
          }
          if (
            sessionRevision === revisionAtStart &&
            currentSession?.refreshToken === refreshTokenAtStart
          ) {
            clearSession();
          }
        }
        throw new Error(responseMessage(response, payload, "Could not refresh your sign-in."));
      }

      const refreshed = sessionFromResponse(payload, activeSession);
      const latestSession = readSession();
      if (sessionRevision !== revisionAtStart) {
        if (latestSession) {
          currentSession = latestSession;
          updateAuthUI();
          return latestSession;
        }
        throw new Error("You signed out while the session was refreshing.");
      }
      if (
        latestSession &&
        latestSession.refreshToken !== refreshTokenAtStart
      ) {
        currentSession = latestSession;
        updateAuthUI();
        return latestSession;
      }
      saveSession(refreshed);
      return refreshed;
    };

    const refreshTask = window.navigator.locks?.request
      ? window.navigator.locks.request(`${SESSION_KEY}-refresh`, performRefresh)
      : performRefresh();
    refreshPromise = refreshTask.finally(() => {
      refreshPromise = null;
    });

    return refreshPromise;
  }

  async function getValidSession(forceRefresh = false) {
    const session = currentSession || readSession();
    if (!session) {
      return null;
    }

    currentSession = session;
    if (!forceRefresh && session.expiresAt > Date.now() + REFRESH_MARGIN_MS) {
      return session;
    }

    return refreshSession(session);
  }

  function setStatus(element, message, tone = "") {
    if (!element) {
      return;
    }
    element.textContent = message;
    if (tone) {
      element.dataset.tone = tone;
    } else {
      delete element.dataset.tone;
    }
  }

  function setBoardStatus(message, tone = "") {
    setStatus(document.querySelector("[data-board-status]"), message, tone);
  }

  function updateCounter(container, textarea) {
    const counter = container.querySelector("[data-message-count]");
    if (counter) {
      counter.textContent = `${textarea.value.length} / ${MESSAGE_LIMIT}`;
    }
  }

  function normalizeAuthorName(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function authorNameError(value) {
    const name = normalizeAuthorName(value);
    if (!name) {
      return "";
    }
    if (
      Array.from(name).length > AUTHOR_NAME_LIMIT ||
      new TextEncoder().encode(name).length > 160
    ) {
      return `Use no more than ${AUTHOR_NAME_LIMIT} characters for your public name.`;
    }
    if (/[\u0000-\u001f\u007f-\u009f]/.test(name) || name.includes("@")) {
      return "Use a name rather than an email address.";
    }
    return "";
  }

  function readDraftRecord() {
    const draft = readStorage(window.sessionStorage, DRAFT_KEY);
    if (!draft || typeof draft.body !== "string") {
      return { body: "", authorName: "" };
    }
    const body = draft.body.slice(0, MESSAGE_LIMIT);
    const authorName = typeof draft.authorName === "string"
      ? Array.from(draft.authorName).slice(0, AUTHOR_NAME_LIMIT).join("")
      : "";
    if (
      typeof draft.requestId === "string" &&
      UUID_PATTERN.test(draft.requestId)
    ) {
      topLevelRequest = {
        body: body.trim(),
        authorName: normalizeAuthorName(authorName),
        id: draft.requestId,
      };
    }
    return { body, authorName };
  }

  function createRequestId() {
    if (typeof window.crypto?.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    const bytes = window.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return [
      hex.slice(0, 4).join(""),
      hex.slice(4, 6).join(""),
      hex.slice(6, 8).join(""),
      hex.slice(8, 10).join(""),
      hex.slice(10).join(""),
    ].join("-");
  }

  function readDraft() {
    return readDraftRecord().body;
  }

  function readDraftAuthorName() {
    return readDraftRecord().authorName;
  }

  function saveDraft(body, authorName = "") {
    const normalizedName = normalizeAuthorName(authorName);
    if (body || normalizedName) {
      writeStorage(window.sessionStorage, DRAFT_KEY, {
        body,
        authorName,
        requestId: topLevelRequest.body === body.trim() &&
          topLevelRequest.authorName === normalizedName
          ? topLevelRequest.id
          : "",
      });
    } else {
      removeStorage(window.sessionStorage, DRAFT_KEY);
    }
  }

  function topLevelRequestId(body, authorName) {
    const normalizedName = normalizeAuthorName(authorName);
    if (
      topLevelRequest.body !== body ||
      topLevelRequest.authorName !== normalizedName ||
      !UUID_PATTERN.test(topLevelRequest.id)
    ) {
      topLevelRequest = { body, authorName: normalizedName, id: createRequestId() };
      saveDraft(body, authorName);
    }
    return topLevelRequest.id;
  }

  function resetTopLevelRequest() {
    topLevelRequest = { body: "", authorName: "", id: "" };
  }

  function readImageIntent() {
    const intent = readStorage(window.localStorage, IMAGE_INTENT_KEY);
    const valid = intent &&
      typeof intent.body === "string" &&
      intent.body.trim().length >= 1 &&
      intent.body.trim().length <= MESSAGE_LIMIT &&
      (typeof intent.authorName === "undefined" ||
        (typeof intent.authorName === "string" && !authorNameError(intent.authorName))) &&
      typeof intent.requestId === "string" &&
      UUID_PATTERN.test(intent.requestId) &&
      typeof intent.imagePath === "string" &&
      IMAGE_PATH_PATTERN.test(intent.imagePath) &&
      typeof intent.userId === "string" &&
      UUID_PATTERN.test(intent.userId) &&
      Number.isFinite(intent.createdAt);

    if (!valid) {
      removeStorage(window.localStorage, IMAGE_INTENT_KEY);
      return null;
    }
    return { ...intent, authorName: intent.authorName || "" };
  }

  function saveImageIntent(body, authorName, requestId, imagePath) {
    const userId = currentSession?.user?.id || "";
    if (!UUID_PATTERN.test(userId)) {
      return false;
    }
    const intent = {
      body,
      authorName,
      requestId,
      imagePath,
      userId,
      createdAt: Date.now(),
    };
    const existing = readImageIntent();
    if (
      existing &&
      (existing.requestId !== requestId || existing.imagePath !== imagePath)
    ) {
      return null;
    }
    if (!writeStorage(window.localStorage, IMAGE_INTENT_KEY, intent)) {
      return null;
    }
    unresolvedImageIntent = intent;
    updateAuthUI();
    return intent;
  }

  function clearImageIntent(expected = null) {
    if (!expected) {
      return false;
    }
    const stored = readImageIntent();
    if (
      stored &&
      (stored.requestId !== expected.requestId || stored.imagePath !== expected.imagePath)
    ) {
      return false;
    }
    unresolvedImageIntent = null;
    removeStorage(window.localStorage, IMAGE_INTENT_KEY);
    updateAuthUI();
    return true;
  }

  function showImageIntent(intent) {
    const { preview, previewImage, summary, remove, status } = imageElements();
    if (!intent || !preview || !previewImage || !summary) {
      return;
    }
    const imageUrl = publicImageUrl(intent.imagePath);
    if (imageUrl) {
      previewImage.src = imageUrl;
    }
    summary.textContent = "Unfinished image post";
    if (remove) {
      remove.textContent = "Discard upload";
    }
    preview.hidden = false;
    setStatus(status, "Finish or discard this interrupted upload before choosing another image.");
  }

  function withImageTransactionLock(operation) {
    if (window.navigator.locks?.request) {
      return window.navigator.locks.request(`${IMAGE_INTENT_KEY}-transaction`, operation);
    }
    return operation();
  }

  async function recoverImageIntent(intent, session, statusElement = null) {
    if (!intent || !session || session.user?.id !== intent.userId) {
      return false;
    }

    if (imageRecoveryPromise) {
      return imageRecoveryPromise;
    }

    const latestIntent = readImageIntent();
    if (
      !latestIntent ||
      latestIntent.requestId !== intent.requestId ||
      latestIntent.imagePath !== intent.imagePath
    ) {
      unresolvedImageIntent = latestIntent;
      updateAuthUI();
      return false;
    }

    setTopLevelFormsBusy(true);
    document.querySelectorAll("[data-auth-action]").forEach((button) => {
      button.disabled = true;
    });
    const report = (message, tone = "") => {
      if (statusElement) {
        setStatus(statusElement, message, tone);
      } else {
        setBoardStatus(message, tone);
      }
    };
    report("Finishing an interrupted image post…");
    const recoveryTask = (async () => {
      return withImageTransactionLock(async () => {
        const currentIntent = readImageIntent();
        if (
          !currentIntent ||
          currentIntent.requestId !== intent.requestId ||
          currentIntent.imagePath !== intent.imagePath
        ) {
          unresolvedImageIntent = currentIntent;
          updateAuthUI();
          return false;
        }
        try {
        const message = await callCreateMessage(
          intent.body,
          null,
          intent.requestId,
          session,
          intent.imagePath,
          intent.authorName,
        );
        clearImageIntent(intent);
        resetTopLevelRequest();
        syncTopLevelDraft("");
        clearSelectedImage();
        if (!isBoardPage) {
          window.location.assign(messageLocation(message.id));
          return true;
        }
        await loadBoard(message.id);
        report("Image post recovered.", "success");
        return true;
        } catch (error) {
          if (!error.postOutcomeAmbiguous) {
            const deleted = await deleteUnlinkedImage(intent.imagePath, currentSession || session);
            if (deleted) {
              clearImageIntent(intent);
            }
          }
          report(
            error.postOutcomeAmbiguous
              ? "The earlier image post still has an uncertain result. Use Retry image post."
              : error.message || "The earlier image post could not be recovered.",
            "error",
          );
          return false;
        }
      });
    })();
    imageRecoveryPromise = recoveryTask;
    try {
      return await recoveryTask;
    } finally {
      if (imageRecoveryPromise === recoveryTask) {
        imageRecoveryPromise = null;
      }
      setTopLevelFormsBusy(false);
      updateAuthUI();
    }
  }

  function imageElements() {
    return {
      input: document.querySelector("[data-image-input]"),
      preview: document.querySelector("[data-image-preview]"),
      previewImage: document.querySelector("[data-image-preview-image]"),
      summary: document.querySelector("[data-image-summary]"),
      remove: document.querySelector("[data-image-remove]"),
      status: document.querySelector("[data-image-status]"),
    };
  }

  function revokeImagePreview() {
    if (selectedImagePreviewUrl) {
      URL.revokeObjectURL(selectedImagePreviewUrl);
      selectedImagePreviewUrl = "";
    }
  }

  function clearSelectedImage(message = "", tone = "") {
    imageSelectionRevision += 1;
    selectedImage = null;
    revokeImagePreview();
    resetTopLevelRequest();

    const { input, preview, previewImage, summary, remove, status } = imageElements();
    if (input) {
      input.value = "";
    }
    if (previewImage) {
      previewImage.removeAttribute("src");
    }
    if (summary) {
      summary.textContent = "Selected image";
    }
    if (remove) {
      remove.textContent = "Remove image";
    }
    if (preview) {
      preview.hidden = true;
    }
    setStatus(status, message, tone);
  }

  function fileSizeLabel(bytes) {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  }

  async function imageDimensions(file) {
    if (typeof window.createImageBitmap === "function") {
      const bitmap = await window.createImageBitmap(file);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dimensions;
    }

    const objectUrl = URL.createObjectURL(file);
    try {
      return await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
        image.onerror = () => reject(new Error("The selected file is not a readable image."));
        image.src = objectUrl;
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function selectImageFile(file, input) {
    const { preview, previewImage, summary, status } = imageElements();
    const revision = ++imageSelectionRevision;

    if (!file) {
      clearSelectedImage();
      return;
    }
    const existingIntent = readImageIntent();
    if (existingIntent) {
      unresolvedImageIntent = existingIntent;
      clearSelectedImage();
      showImageIntent(existingIntent);
      updateAuthUI();
      return;
    }
    if (!currentSession) {
      clearSelectedImage("Sign in with Google before choosing an image.", "error");
      return;
    }
    if (!IMAGE_TYPES.has(file.type)) {
      clearSelectedImage("Choose a JPEG, PNG, or WebP image.", "error");
      return;
    }
    if (file.size < 1 || file.size > IMAGE_LIMIT) {
      clearSelectedImage("Choose an image no larger than 5 MB.", "error");
      return;
    }

    setStatus(status, "Checking image…");
    input.disabled = true;
    let dimensions;
    try {
      dimensions = await imageDimensions(file);
    } catch {
      if (revision === imageSelectionRevision) {
        clearSelectedImage("The selected file is not a readable image.", "error");
      }
      updateAuthUI();
      return;
    }

    if (revision !== imageSelectionRevision) {
      updateAuthUI();
      return;
    }
    const intentAfterDecode = readImageIntent();
    if (intentAfterDecode) {
      unresolvedImageIntent = intentAfterDecode;
      clearSelectedImage();
      showImageIntent(intentAfterDecode);
      updateAuthUI();
      return;
    }
    if (
      dimensions.width < 1 ||
      dimensions.height < 1 ||
      dimensions.width > IMAGE_SIDE_LIMIT ||
      dimensions.height > IMAGE_SIDE_LIMIT ||
      dimensions.width * dimensions.height > IMAGE_PIXEL_LIMIT
    ) {
      clearSelectedImage("Choose an image with fewer than 40 million pixels.", "error");
      updateAuthUI();
      return;
    }

    revokeImagePreview();
    selectedImage = file;
    selectedImagePreviewUrl = URL.createObjectURL(file);
    resetTopLevelRequest();
    previewImage.src = selectedImagePreviewUrl;
    summary.textContent = `${dimensions.width} × ${dimensions.height} · ${fileSizeLabel(file.size)}`;
    preview.hidden = false;
    setStatus(status, "Image ready to upload.", "success");
    updateAuthUI();
  }

  function initializeImageUpload() {
    const input = document.querySelector("[data-image-input]");
    const removeButton = document.querySelector("[data-image-remove]");
    if (!input) {
      return;
    }

    input.addEventListener("change", () => {
      const task = selectImageFile(input.files?.[0] || null, input);
      const pending = task.finally(() => {
        if (imageSelectionPromise === pending) {
          imageSelectionPromise = null;
        }
      });
      imageSelectionPromise = pending;
    });
    removeButton?.addEventListener("click", async () => {
      if (unresolvedImageIntent) {
        let session;
        try {
          session = await getValidSession();
        } catch (error) {
          setStatus(imageElements().status, error.message, "error");
          return;
        }
        if (!session) {
          setStatus(imageElements().status, "Sign in to discard the interrupted upload.");
          await startGoogleSignIn({
            keepPending: false,
            statusElement: imageElements().status,
          });
          return;
        }
        if (session.user?.id !== unresolvedImageIntent.userId) {
          setStatus(
            imageElements().status,
            "Sign in with the account that started this upload.",
            "error",
          );
          return;
        }

        const intent = unresolvedImageIntent;
        removeButton.disabled = true;
        setStatus(imageElements().status, "Discarding interrupted upload…");
        const deleted = await withImageTransactionLock(
          () => deleteUnlinkedImage(intent.imagePath, currentSession || session),
        );
        if (deleted) {
          clearImageIntent(intent);
          clearSelectedImage("Interrupted upload discarded.", "success");
        } else {
          setStatus(
            imageElements().status,
            "This upload could not be discarded. Retry the image post to resolve it.",
            "error",
          );
        }
        updateAuthUI();
        return;
      }
      clearSelectedImage("Image removed.");
      updateAuthUI();
      input.focus();
    });
  }

  function syncTopLevelDraft(body, authorName = "", sourceControl = null) {
    const normalizedName = normalizeAuthorName(authorName);
    if (
      topLevelRequest.body &&
      (topLevelRequest.body !== body.trim() || topLevelRequest.authorName !== normalizedName)
    ) {
      resetTopLevelRequest();
    }
    saveDraft(body, authorName);
    const pending = readPendingMessage();
    if (
      pending?.parentId === null &&
      (pending.body.trim() !== body.trim() ||
        normalizeAuthorName(pending.authorName) !== normalizedName)
    ) {
      removeStorage(window.sessionStorage, PENDING_KEY);
    }
    document.querySelectorAll('[data-message-form="top-level"]').forEach((form) => {
      const textarea = form.querySelector("[data-message-body]");
      const nameInput = form.querySelector("[data-message-author-name]");
      if (textarea && textarea !== sourceControl) {
        textarea.value = body;
      }
      if (nameInput && nameInput !== sourceControl) {
        nameInput.value = authorName;
      }
      if (textarea) {
        updateCounter(form, textarea);
      }
    });
  }

  function savePendingMessage(
    body,
    authorName = "",
    parentId = null,
    requestId = createRequestId(),
  ) {
    return writeStorage(window.sessionStorage, PENDING_KEY, {
      body,
      authorName,
      parentId,
      requestId,
      createdAt: Date.now(),
    });
  }

  function readPendingMessage() {
    const pending = readStorage(window.sessionStorage, PENDING_KEY);
    const isValid = pending &&
      typeof pending.body === "string" &&
      pending.body.trim().length >= 1 &&
      pending.body.trim().length <= MESSAGE_LIMIT &&
      (typeof pending.authorName === "undefined" ||
        (typeof pending.authorName === "string" && !authorNameError(pending.authorName))) &&
      Number.isFinite(pending.createdAt) &&
      Date.now() - pending.createdAt <= INTENT_TTL_MS &&
      typeof pending.requestId === "string" &&
      UUID_PATTERN.test(pending.requestId) &&
      (pending.parentId === null || UUID_PATTERN.test(pending.parentId));

    if (!isValid) {
      removeStorage(window.sessionStorage, PENDING_KEY);
      return null;
    }
    return { ...pending, authorName: pending.authorName || "" };
  }

  function clearPendingReplyIfChanged(parentId, body = null, authorName = null) {
    const pending = readPendingMessage();
    if (!pending || pending.parentId !== parentId) {
      return;
    }
    if (
      body === null ||
      pending.body.trim() !== String(body).trim() ||
      normalizeAuthorName(pending.authorName) !== normalizeAuthorName(authorName)
    ) {
      removeStorage(window.sessionStorage, PENDING_KEY);
    }
  }

  function readImageCleanupQueue() {
    const stored = readStorage(window.localStorage, IMAGE_CLEANUP_KEY);
    const items = Array.isArray(stored?.items) ? stored.items : [];
    return items.filter((item) => (
      IMAGE_PATH_PATTERN.test(item?.imagePath || "") &&
      UUID_PATTERN.test(item?.userId || "") &&
      Number.isFinite(item?.createdAt)
    )).slice(-20);
  }

  function writeImageCleanupQueue(items) {
    if (!items.length) {
      removeStorage(window.localStorage, IMAGE_CLEANUP_KEY);
      return true;
    }
    return writeStorage(window.localStorage, IMAGE_CLEANUP_KEY, { items: items.slice(-20) });
  }

  function queueImageCleanup(imagePath, userId) {
    if (!IMAGE_PATH_PATTERN.test(imagePath || "") || !UUID_PATTERN.test(userId || "")) {
      return false;
    }
    const items = readImageCleanupQueue().filter((item) => item.imagePath !== imagePath);
    items.push({ imagePath, userId, createdAt: Date.now() });
    return writeImageCleanupQueue(items);
  }

  async function processImageCleanupQueue(session) {
    if (!session?.user?.id || !session.accessToken) {
      return true;
    }
    const queue = readImageCleanupQueue();
    const remaining = [];
    let allRemoved = true;
    for (const item of queue) {
      if (item.userId !== session.user.id) {
        remaining.push(item);
        continue;
      }
      const removed = await deleteUnlinkedImage(item.imagePath, currentSession || session);
      if (!removed) {
        remaining.push(item);
        allRemoved = false;
      }
    }
    writeImageCleanupQueue(remaining);
    return allRemoved;
  }

  async function getServerImageCleanupQueue(session) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_board_image_cleanup_queue`, {
      method: "POST",
      headers: {
        apikey: PUBLISHABLE_KEY,
        Authorization: `Bearer ${session.accessToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (!response.ok) {
      return [];
    }
    const payload = await parseResponse(response);
    return (Array.isArray(payload) ? payload : [])
      .map((item) => item?.image_path)
      .filter((path) => IMAGE_PATH_PATTERN.test(path || ""));
  }

  async function confirmServerImageCleanup(imagePath, session) {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/confirm_board_image_cleanup`, {
        method: "POST",
        headers: {
          apikey: PUBLISHABLE_KEY,
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_image_path: imagePath }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function processServerImageCleanupQueue(session) {
    try {
      const paths = await getServerImageCleanupQueue(session);
      for (const imagePath of paths) {
        if (await deleteUnlinkedImage(imagePath, currentSession || session)) {
          await confirmServerImageCleanup(imagePath, currentSession || session);
        }
      }
    } catch {
      // Cleanup remains durable in PostgreSQL and will be retried later.
    }
  }

  function base64Url(bytes) {
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return window.btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  function boardUrl() {
    const url = new URL("board.html", window.location.href);
    url.search = "";
    url.hash = "";
    return url;
  }

  async function startGoogleSignIn({
    keepPending = false,
    statusElement = null,
    redirectUrl = boardUrl(),
  } = {}) {
    if (signInStarting) {
      setStatus(statusElement, "Google sign-in is already starting.");
      return;
    }
    signInStarting = true;
    document.querySelectorAll("[data-auth-action]").forEach((button) => {
      button.disabled = true;
    });

    if (!keepPending) {
      removeStorage(window.sessionStorage, PENDING_KEY);
    }

    if (!["http:", "https:"].includes(window.location.protocol)) {
      setStatus(
        statusElement,
        "Open this site through a web server before signing in.",
        "error",
      );
      signInStarting = false;
      updateAuthUI();
      return;
    }

    if (!window.crypto?.subtle) {
      setStatus(statusElement, "This browser cannot start a secure sign-in.", "error");
      signInStarting = false;
      updateAuthUI();
      return;
    }

    let verifier;
    let challenge;
    try {
      verifier = base64Url(window.crypto.getRandomValues(new Uint8Array(64)));
      const digest = await window.crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(verifier),
      );
      challenge = base64Url(new Uint8Array(digest));
    } catch {
      setStatus(statusElement, "This browser could not prepare a secure sign-in.", "error");
      signInStarting = false;
      updateAuthUI();
      return;
    }
    const stored = writeStorage(window.sessionStorage, PKCE_KEY, {
      verifier,
      createdAt: Date.now(),
    });

    if (!stored) {
      setStatus(
        statusElement,
        "Allow session storage in this browser to sign in.",
        "error",
      );
      signInStarting = false;
      updateAuthUI();
      return;
    }

    setStatus(statusElement, "Redirecting to Google sign-in…");
    const authorizeUrl = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
    authorizeUrl.searchParams.set("provider", "google");
    authorizeUrl.searchParams.set("redirect_to", redirectUrl.href);
    authorizeUrl.searchParams.set("scopes", "openid email profile");
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "s256");
    try {
      window.location.assign(authorizeUrl.href);
    } catch (error) {
      signInStarting = false;
      updateAuthUI();
      throw error;
    }
  }

  function cleanAuthParameters(url) {
    ["code", "error", "error_code", "error_description"].forEach((name) => {
      url.searchParams.delete(name);
    });
    const search = url.searchParams.toString();
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${search ? `?${search}` : ""}${url.hash}`,
    );
  }

  async function handleAuthCallback() {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const authError = url.searchParams.get("error_description") || url.searchParams.get("error");

    if (!code && !authError) {
      return "";
    }

    if (authError) {
      cleanAuthParameters(url);
      removeStorage(window.sessionStorage, PKCE_KEY);
      throw new Error(`Google sign-in was not completed: ${authError}`);
    }

    const pkce = readStorage(window.sessionStorage, PKCE_KEY);
    if (
      !pkce ||
      typeof pkce.verifier !== "string" ||
      !Number.isFinite(pkce.createdAt) ||
      Date.now() - pkce.createdAt > INTENT_TTL_MS
    ) {
      cleanAuthParameters(url);
      removeStorage(window.sessionStorage, PKCE_KEY);
      throw new Error("The sign-in attempt expired. Please start again.");
    }

    let response;
    try {
      response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
        method: "POST",
        headers: {
          apikey: PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          auth_code: code,
          code_verifier: pkce.verifier,
        }),
      });
    } catch {
      throw new Error("Could not reach the sign-in service. Please try again.");
    }

    const payload = await parseResponse(response);
    if (!response.ok) {
      cleanAuthParameters(url);
      removeStorage(window.sessionStorage, PKCE_KEY);
      throw new Error(responseMessage(response, payload, "Google sign-in could not be completed."));
    }

    cleanAuthParameters(url);
    removeStorage(window.sessionStorage, PKCE_KEY);
    saveSession(sessionFromResponse(payload));
    return "Google sign-in completed.";
  }

  async function signOut(button) {
    const session = currentSession || readSession();
    clearSession();
    removeStorage(window.sessionStorage, PENDING_KEY);
    button.disabled = true;

    try {
      if (session?.accessToken) {
        await fetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`, {
          method: "POST",
          headers: {
            apikey: PUBLISHABLE_KEY,
            Authorization: `Bearer ${session.accessToken}`,
          },
        });
      }
    } catch {
      // Local sign-out still succeeds if the network request cannot complete.
    } finally {
      button.disabled = false;
      setBoardStatus("Signed out.");
      if (isBoardPage) {
        await loadBoard("", true);
      }
    }
  }

  function updateAuthUI() {
    const session = currentSession;
    const displayName = session?.user?.displayName || "Google user";
    const recoveringImage = Boolean(
      unresolvedImageIntent &&
      session?.user?.id === unresolvedImageIntent.userId,
    );

    document.querySelectorAll("[data-auth-status]").forEach((element) => {
      element.textContent = session ? `Signed in as ${displayName}.` : "Not signed in.";
    });

    document.querySelectorAll("[data-session-note]").forEach((element) => {
      element.textContent = session ? `Signed in as ${displayName}.` : "Google sign-in required.";
    });

    document.querySelectorAll("[data-auth-action]").forEach((button) => {
      button.textContent = session ? "Sign out" : "Sign in with Google";
      button.dataset.authMode = session ? "sign-out" : "sign-in";
      button.disabled = signInStarting || Boolean(topLevelSubmitPromise) || Boolean(imageRecoveryPromise);
    });

    document.querySelectorAll("[data-message-submit], [data-reply-submit]").forEach((button) => {
      button.textContent = unresolvedImageIntent && button.matches("[data-message-submit]")
        ? recoveringImage ? "Retry image post" : "Resolve image post"
        : session
        ? button.dataset.signedInLabel || "Post"
        : "Sign in & post";
    });

    document.querySelectorAll('[data-message-form="top-level"] [data-message-body]').forEach((textarea) => {
      textarea.readOnly = Boolean(unresolvedImageIntent);
    });

    document.querySelectorAll("[data-image-input]").forEach((input) => {
      const formIsBusy = input.closest("form")?.getAttribute("aria-busy") === "true";
      input.disabled = !session || formIsBusy || Boolean(unresolvedImageIntent);
    });
    document.querySelectorAll("[data-image-remove]").forEach((button) => {
      const formIsBusy = button.closest("form")?.getAttribute("aria-busy") === "true";
      button.disabled = formIsBusy || Boolean(imageRecoveryPromise);
    });

    window.dispatchEvent(new CustomEvent("jiwon-auth-change", {
      detail: {
        signedIn: Boolean(session),
        displayName: session ? displayName : "",
      },
    }));
  }

  function initializeAuthActions() {
    document.querySelectorAll("[data-auth-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (currentSession) {
          await signOut(button);
          return;
        }
        try {
          await startGoogleSignIn({
            statusElement: document.querySelector("[data-board-status]"),
          });
        } catch {
          signInStarting = false;
          updateAuthUI();
          setBoardStatus("Google sign-in could not be started.", "error");
        }
      });
    });
  }

  function encodedImagePath(imagePath) {
    return imagePath.split("/").map(encodeURIComponent).join("/");
  }

  function publicImageUrl(imagePath) {
    if (!IMAGE_PATH_PATTERN.test(imagePath || "")) {
      return "";
    }
    return `${SUPABASE_URL}/storage/v1/object/public/${IMAGE_BUCKET}/${encodedImagePath(imagePath)}`;
  }

  async function callPrepareImageUpload(requestId, mimeType, session, retried = false) {
    let response;
    try {
      response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/prepare_board_image_upload`, {
        method: "POST",
        headers: {
          apikey: PUBLISHABLE_KEY,
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_request_id: requestId,
          p_mime_type: mimeType,
        }),
      });
    } catch {
      throw new Error("Could not reach image storage. Please try again.");
    }

    const payload = await parseResponse(response);
    if (response.status === 401 && !retried) {
      const refreshed = await getValidSession(true);
      if (refreshed) {
        return callPrepareImageUpload(requestId, mimeType, refreshed, true);
      }
    }
    if (!response.ok) {
      if (response.status === 401) {
        clearSession();
      }
      throw new Error(responseMessage(response, payload, "The image upload could not be prepared."));
    }

    const reservation = Array.isArray(payload) ? payload[0] : payload;
    const imagePath = reservation?.image_path;
    if (
      typeof imagePath !== "string" ||
      !IMAGE_PATH_PATTERN.test(imagePath) ||
      reservation.mime_type !== mimeType ||
      typeof reservation.already_consumed !== "boolean"
    ) {
      throw new Error("Image storage returned an incomplete response.");
    }
    return {
      imagePath,
      alreadyConsumed: reservation.already_consumed,
    };
  }

  async function uploadImage(file, imagePath, session, retried = false) {
    const extension = IMAGE_TYPES.get(file.type);
    const formData = new FormData();
    formData.append("cacheControl", "3600");
    formData.append("", file, `upload.${extension}`);

    let response;
    try {
      response = await fetch(
        `${SUPABASE_URL}/storage/v1/object/${IMAGE_BUCKET}/${encodedImagePath(imagePath)}`,
        {
          method: "POST",
          headers: {
            apikey: PUBLISHABLE_KEY,
            Authorization: `Bearer ${session.accessToken}`,
            "x-upsert": "false",
          },
          body: formData,
        },
      );
    } catch {
      throw new Error("Could not upload the image. Please try again.");
    }

    const payload = await parseResponse(response);
    if (response.status === 401 && !retried) {
      const refreshed = await getValidSession(true);
      if (refreshed) {
        return uploadImage(file, imagePath, refreshed, true);
      }
    }

    const storageCode = typeof payload?.error === "string" ? payload.error : "";
    const storageMessage = typeof payload?.message === "string" ? payload.message : "";
    if (
      response.status === 409 ||
      storageCode.includes("AlreadyExists") ||
      storageMessage.toLowerCase().includes("already exists")
    ) {
      return;
    }
    if (!response.ok) {
      if (response.status === 401) {
        clearSession();
      }
      if (response.status === 413) {
        throw new Error("Choose an image no larger than 5 MB.");
      }
      if (response.status === 403) {
        throw new Error("This account does not have permission to upload this image.");
      }
      throw new Error("The image could not be uploaded. Please choose it again.");
    }
  }

  async function deleteUnlinkedImage(imagePath, session, retried = false) {
    if (!IMAGE_PATH_PATTERN.test(imagePath || "") || !session?.accessToken) {
      return false;
    }
    try {
      const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${IMAGE_BUCKET}`, {
        method: "DELETE",
        headers: {
          apikey: PUBLISHABLE_KEY,
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prefixes: [imagePath] }),
      });
      if (response.status === 401 && !retried) {
        const refreshed = await getValidSession(true);
        if (refreshed) {
          return deleteUnlinkedImage(imagePath, refreshed, true);
        }
      }
      return response.ok || response.status === 404;
    } catch {
      // The upload reservation and immutable path make a later retry safe.
      return false;
    }
  }

  async function callCreateMessage(
    body,
    parentId,
    requestId,
    session,
    imagePath = null,
    authorName = "",
    retried = false,
  ) {
    let response;
    try {
      response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_board_message`, {
        method: "POST",
        headers: {
          apikey: PUBLISHABLE_KEY,
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_body: body,
          p_parent_id: parentId,
          p_request_id: requestId,
          p_image_path: imagePath,
          p_author_name: normalizeAuthorName(authorName) || null,
        }),
      });
    } catch {
      throw messageRequestError(
        "The post may have been received, but the response was interrupted. Please retry.",
        true,
      );
    }

    let payload;
    try {
      payload = await parseResponse(response);
    } catch {
      const outcomeAmbiguous = response.ok || response.status === 408 || response.status >= 500;
      throw messageRequestError(
        response.ok
          ? "The post may have succeeded, but its response was incomplete. Please retry."
          : "The board returned an unreadable error. Please try again.",
        outcomeAmbiguous,
      );
    }
    if (response.status === 401 && !retried) {
      const refreshed = await getValidSession(true);
      if (refreshed) {
        return callCreateMessage(
          body,
          parentId,
          requestId,
          refreshed,
          imagePath,
          authorName,
          true,
        );
      }
    }

    if (!response.ok) {
      if (response.status === 401) {
        clearSession();
      }
      throw messageRequestError(
        responseMessage(response, payload, "The message could not be posted."),
        response.status === 408 || response.status >= 500,
      );
    }

    const message = Array.isArray(payload) ? payload[0] : payload;
    if (!message || typeof message.id !== "string") {
      throw messageRequestError(
        "The post may have succeeded, but its response was incomplete. Please retry.",
        true,
      );
    }
    return message;
  }

  async function callUpdateMessage(
    messageId,
    body,
    requestId,
    imagePath,
    session,
    retried = false,
  ) {
    let response;
    try {
      response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/update_board_message`, {
        method: "POST",
        headers: {
          apikey: PUBLISHABLE_KEY,
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_message_id: messageId,
          p_body: body,
          p_request_id: requestId,
          p_image_path: imagePath,
        }),
      });
    } catch {
      throw messageRequestError(
        "The edit may have been received, but the response was interrupted. Press Save edit again.",
        true,
      );
    }
    let payload;
    try {
      payload = await parseResponse(response);
    } catch {
      throw messageRequestError(
        response.ok
          ? "The edit may have succeeded, but its response was incomplete. Press Save edit again."
          : "The board returned an unreadable edit error. Please try again.",
        response.ok || response.status === 408 || response.status >= 500,
      );
    }
    if (response.status === 401 && !retried) {
      const refreshed = await getValidSession(true);
      if (refreshed) {
        return callUpdateMessage(
          messageId,
          body,
          requestId,
          imagePath,
          refreshed,
          true,
        );
      }
    }
    if (!response.ok) {
      if (response.status === 401) {
        clearSession();
      }
      throw messageRequestError(
        responseMessage(response, payload, "The edit could not be saved."),
        response.status === 408 || response.status >= 500,
      );
    }
    const message = Array.isArray(payload) ? payload[0] : payload;
    if (!message || message.id !== messageId) {
      throw messageRequestError(
        "The edit response was incomplete. Press Save edit again to verify it.",
        true,
      );
    }
    return message;
  }

  async function callDeleteMessage(messageId, session, retried = false) {
    let response;
    try {
      response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/delete_board_message`, {
        method: "POST",
        headers: {
          apikey: PUBLISHABLE_KEY,
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_message_id: messageId }),
      });
    } catch {
      throw new Error("The message could not be deleted. Please try again.");
    }
    const payload = await parseResponse(response);
    if (response.status === 401 && !retried) {
      const refreshed = await getValidSession(true);
      if (refreshed) {
        return callDeleteMessage(messageId, refreshed, true);
      }
    }
    if (!response.ok) {
      if (response.status === 401) {
        clearSession();
      }
      throw new Error(responseMessage(response, payload, "The message could not be deleted."));
    }
    const result = Array.isArray(payload) ? payload[0] : payload;
    if (
      !result ||
      result.message_id !== messageId ||
      !["hard_deleted", "tombstoned"].includes(result.deletion_mode)
    ) {
      throw new Error("The deletion response was incomplete. Refresh the board to verify it.");
    }
    return result;
  }

  function setFormBusy(form, busy) {
    form.querySelectorAll("textarea, input, button").forEach((control) => {
      control.disabled = busy;
    });
    form.setAttribute("aria-busy", String(busy));
  }

  function setTopLevelFormsBusy(busy) {
    document.querySelectorAll('[data-message-form="top-level"]').forEach((form) => {
      setFormBusy(form, busy);
    });
  }

  async function withTopLevelSubmitLock(status, operation) {
    if (topLevelSubmitPromise) {
      setStatus(status, "A message is already being posted.");
      return null;
    }

    setTopLevelFormsBusy(true);
    const task = operation();
    topLevelSubmitPromise = task;
    updateAuthUI();
    try {
      return await task;
    } finally {
      if (topLevelSubmitPromise === task) {
        topLevelSubmitPromise = null;
      }
      setTopLevelFormsBusy(false);
      syncTopLevelDraft(readDraft(), readDraftAuthorName());
      updateAuthUI();
    }
  }

  function messageLocation(messageId) {
    const url = boardUrl();
    url.hash = `message-${messageId}`;
    return url.href;
  }

  async function submitTopLevelMessage(form) {
    const textarea = form.querySelector("[data-message-body]");
    const nameInput = form.querySelector("[data-message-author-name]");
    const status = form.querySelector("[data-message-status]");
    if (!textarea || !nameInput || !status) {
      setBoardStatus("The message form could not be initialized. Refresh and try again.", "error");
      return;
    }
    const hadPendingImageSelection = Boolean(imageSelectionPromise);

    // A user can replace a file while the previous one is still being decoded.
    // Wait until the most recent selection has settled before taking a snapshot.
    while (imageSelectionPromise) {
      await imageSelectionPromise;
    }
    if (hadPendingImageSelection && !selectedImage) {
      setStatus(status, "The image was not attached. Check the image message and try again.", "error");
      imageElements().input?.focus();
      return;
    }
    const body = textarea.value.trim();
    const authorName = normalizeAuthorName(nameInput?.value || "");
    const imageFile = selectedImage;

    if (unresolvedImageIntent) {
      let session;
      try {
        session = await getValidSession();
      } catch (error) {
        setStatus(status, error.message, "error");
        return;
      }
      if (!session || session.user?.id !== unresolvedImageIntent.userId) {
        if (!session) {
          setStatus(status, "Sign in to finish the interrupted image post.");
          await startGoogleSignIn({ keepPending: false, statusElement: status });
          return;
        }
        setStatus(status, "Sign in with the account that started this image post.", "error");
        return;
      }
      await recoverImageIntent(unresolvedImageIntent, session, status);
      return;
    }

    if (!body || body.length > MESSAGE_LIMIT) {
      setStatus(status, `Enter a message between 1 and ${MESSAGE_LIMIT} characters.`, "error");
      textarea.focus();
      return;
    }
    const nameError = authorNameError(authorName);
    if (nameError) {
      nameInput?.setAttribute("aria-invalid", "true");
      setStatus(status, nameError, "error");
      nameInput?.focus();
      return;
    }
    nameInput?.removeAttribute("aria-invalid");

    const postOperation = async () => {
      const existingIntent = readImageIntent();
      if (existingIntent) {
        unresolvedImageIntent = existingIntent;
        showImageIntent(existingIntent);
        updateAuthUI();
        setStatus(status, "Finish the earlier image post before starting a new one.", "error");
        return;
      }
      setStatus(status, imageFile ? "Preparing image upload…" : "Posting your message…");
      const requestId = topLevelRequestId(body, authorName);
      let session = null;
      let imagePath = null;
      let activeImageIntent = null;
      let messageRequestStarted = false;

      try {
        try {
          session = await getValidSession();
        } catch (error) {
          setStatus(status, error.message, "error");
          return;
        }

        if (!session) {
          if (imageFile) {
            clearSelectedImage("Sign in first, then choose the image again.", "error");
            setStatus(status, "Sign in first, then choose the image again.", "error");
            return;
          }
          if (!savePendingMessage(body, authorName, null, requestId)) {
            setStatus(status, "Allow session storage in this browser to continue.", "error");
            return;
          }
          saveDraft(body, authorName);
          await startGoogleSignIn({ keepPending: true, statusElement: status });
          return;
        }

        if (imageFile) {
          setStatus(imageElements().status, "Preparing image upload…");
          const reservation = await callPrepareImageUpload(
            requestId,
            imageFile.type,
            session,
          );
          imagePath = reservation.imagePath;
          const savedImageIntent = saveImageIntent(body, authorName, requestId, imagePath);
          if (!savedImageIntent) {
            await deleteUnlinkedImage(imagePath, currentSession || session);
            throw new Error("Allow local storage in this browser to attach an image safely.");
          }
          activeImageIntent = savedImageIntent;
          if (!reservation.alreadyConsumed) {
            setStatus(status, "Uploading image…");
            setStatus(imageElements().status, "Uploading image…");
            await uploadImage(imageFile, imagePath, session);
          }
          setStatus(status, "Posting your message…");
          setStatus(imageElements().status, "Image uploaded. Posting message…");
        }

        messageRequestStarted = true;
        const message = await callCreateMessage(
          body,
          null,
          requestId,
          session,
          imagePath,
          authorName,
        );
        const latestDraft = readDraft();
        const latestName = normalizeAuthorName(readDraftAuthorName());
        const shouldClearPostedDraft = latestDraft.trim() === body && latestName === authorName;
        const pending = readPendingMessage();
        if (pending?.requestId === requestId) {
          removeStorage(window.sessionStorage, PENDING_KEY);
        }
        if (imagePath) {
          clearImageIntent(activeImageIntent);
        }
        if (shouldClearPostedDraft) {
          resetTopLevelRequest();
          syncTopLevelDraft("");
        }
        clearSelectedImage();
        setStatus(status, "Message posted.", "success");

        if (!isBoardPage) {
          window.location.assign(messageLocation(message.id));
          return;
        }

        await loadBoard(message.id);
      } catch (error) {
        // Once the message request starts, its outcome can be ambiguous if the
        // network drops. Keep the immutable upload so the same request id can
        // be retried without risking a published post with a missing image.
        if (imagePath && !messageRequestStarted) {
          const deleted = await deleteUnlinkedImage(imagePath, currentSession || session);
          if (deleted) {
            clearImageIntent(activeImageIntent);
          }
        }
        setStatus(status, error.message || "The message could not be posted.", "error");
      }
    };
    await withTopLevelSubmitLock(
      status,
      () => withImageTransactionLock(postOperation),
    );
  }

  function initializeTopLevelForms() {
    const draft = readDraft();
    const draftAuthorName = readDraftAuthorName();
    document.querySelectorAll('[data-message-form="top-level"]').forEach((form) => {
      const textarea = form.querySelector("[data-message-body]");
      if (!textarea) {
        return;
      }

      let nameInput = form.querySelector("[data-message-author-name]");
      if (!nameInput) {
        const field = makeElement("div", "board-name-field");
        const inputId = `${textarea.id || `message-${createRequestId()}`}-author-name`;
        const label = makeElement("label", "board-name-label", "Public name (optional)");
        label.htmlFor = inputId;
        nameInput = makeElement("input", "board-name-input");
        nameInput.id = inputId;
        nameInput.name = "author_name";
        nameInput.type = "text";
        nameInput.maxLength = AUTHOR_NAME_LIMIT;
        nameInput.autocomplete = "nickname";
        nameInput.dataset.messageAuthorName = "";
        field.append(label, nameInput);
        form.insertBefore(field, textarea);
      }

      textarea.value = draft;
      nameInput.value = draftAuthorName;
      updateCounter(form, textarea);
      textarea.addEventListener("input", () => {
        syncTopLevelDraft(textarea.value, nameInput.value, textarea);
      });
      nameInput.addEventListener("input", () => {
        nameInput.removeAttribute("aria-invalid");
        syncTopLevelDraft(textarea.value, nameInput.value, nameInput);
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void submitTopLevelMessage(form);
      });
    });
  }

  async function fetchBoardRows(url) {
    let response;
    try {
      response = await fetch(url, {
        headers: { apikey: PUBLISHABLE_KEY },
      });
    } catch {
      throw new Error("Could not reach the board. Please try again.");
    }

    const payload = await parseResponse(response);
    if (!response.ok) {
      throw new Error(responseMessage(response, payload, "Messages could not be loaded."));
    }
    return Array.isArray(payload) ? payload : [];
  }

  async function getBoardMessages() {
    const fields = "id,parent_id,author_name,author_email,body,image_path,created_at,edited_at,deleted_at";
    const rootUrl = new URL(`${SUPABASE_URL}/rest/v1/board_messages`);
    rootUrl.searchParams.set("select", fields);
    rootUrl.searchParams.set("parent_id", "is.null");
    rootUrl.searchParams.set("order", "created_at.desc");
    rootUrl.searchParams.set("limit", "50");
    const roots = await fetchBoardRows(rootUrl);

    if (!roots.length) {
      return { roots, replies: [] };
    }

    const replyUrl = new URL(`${SUPABASE_URL}/rest/v1/board_messages`);
    replyUrl.searchParams.set("select", fields);
    replyUrl.searchParams.set("parent_id", `in.(${roots.map((message) => message.id).join(",")})`);
    replyUrl.searchParams.set("order", "created_at.desc");
    replyUrl.searchParams.set("limit", "500");
    const replies = await fetchBoardRows(replyUrl);
    replies.sort((left, right) => (
      new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
    ));
    return { roots, replies };
  }

  async function getBoardPermissions(retried = false) {
    try {
      const session = await getValidSession();
      if (!session?.accessToken) {
        boardPermissionWarning = "";
        return new Map();
      }

      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_board_message_permissions`, {
        method: "POST",
        headers: {
          apikey: PUBLISHABLE_KEY,
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      if (response.status === 401 && !retried) {
        const refreshed = await getValidSession(true);
        return refreshed ? getBoardPermissions(true) : new Map();
      }
      if (!response.ok) {
        throw new Error("Permission request failed.");
      }
      const payload = await parseResponse(response);
      const permissions = new Map();
      (Array.isArray(payload) ? payload : []).forEach((entry) => {
        if (UUID_PATTERN.test(entry?.message_id || "")) {
          permissions.set(entry.message_id, {
            canEdit: entry.can_edit === true,
            canDelete: entry.can_delete === true,
          });
        }
      });
      boardPermissionWarning = "";
      return permissions;
    } catch {
      boardPermissionWarning = currentSession
        ? "Message controls are temporarily unavailable. Refresh to retry."
        : "";
      return new Map();
    }
  }

  function makeElement(tagName, className = "", text = "") {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (text) {
      element.textContent = text;
    }
    return element;
  }

  function makeMessageMeta(message) {
    const header = makeElement("header", "board-message-header");
    const byline = makeElement("div", "board-message-byline");
    if (message.deleted_at) {
      byline.append(makeElement("strong", "board-author", "Deleted"));
    } else {
      const displayName = message.author_name || message.author_email || "Google user";
      const email = safeEmail(message.author_email);
      if (email) {
        const author = makeElement("a", "board-author", displayName);
        author.href = `mailto:${email}`;
        author.setAttribute("aria-label", `Email ${displayName}`);
        byline.append(author);
      } else {
        byline.append(makeElement("strong", "board-author", displayName));
      }
    }

    const time = makeElement("time", "board-time");
    const date = new Date(message.created_at);
    if (Number.isNaN(date.getTime())) {
      time.textContent = "Date unavailable";
    } else {
      time.dateTime = date.toISOString();
      time.textContent = new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
    }
    byline.append(time);
    if (message.edited_at && !message.deleted_at) {
      byline.append(makeElement("span", "board-edited", "(Edited)"));
    }
    header.append(byline);
    return header;
  }

  function makeImageAttachment(message) {
    const imageUrl = publicImageUrl(message.image_path);
    if (!imageUrl) {
      return null;
    }

    const figure = makeElement("figure", "board-attachment");
    const link = document.createElement("a");
    link.href = imageUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute(
      "aria-label",
      `Open image attached by ${message.author_name || "Google user"} in a new tab`,
    );

    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = `Image attached by ${message.author_name || "Google user"}`;
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    link.append(image);
    figure.append(link, makeElement("figcaption", "", "Puzzle image request"));
    return figure;
  }

  function buildReplyForm(parentMessage) {
    const form = makeElement("form", "reply-composer");
    const formId = `reply-form-${parentMessage.id}`;
    const textareaId = `reply-body-${parentMessage.id}`;
    const counterId = `reply-count-${parentMessage.id}`;
    const nameId = `reply-name-${parentMessage.id}`;
    const savedDraft = replyDrafts.get(parentMessage.id);
    form.id = formId;
    form.action = "board.html";
    form.method = "post";
    form.dataset.replyParentId = parentMessage.id;
    if (UUID_PATTERN.test(savedDraft?.requestId || "")) {
      form.dataset.requestId = savedDraft.requestId;
    }
    form.hidden = !savedDraft?.open;

    const label = makeElement("label", "reply-label", `Reply to ${parentMessage.author_name}`);
    label.htmlFor = textareaId;
    const nameField = makeElement("div", "board-name-field board-name-field--reply");
    const nameLabel = makeElement("label", "board-name-label", "Public name (optional)");
    nameLabel.htmlFor = nameId;
    const nameInput = makeElement("input", "board-name-input");
    nameInput.id = nameId;
    nameInput.name = "author_name";
    nameInput.type = "text";
    nameInput.maxLength = AUTHOR_NAME_LIMIT;
    nameInput.autocomplete = "nickname";
    nameInput.dataset.messageAuthorName = "";
    nameInput.value = savedDraft?.authorName || "";
    nameField.append(nameLabel, nameInput);
    const textarea = makeElement("textarea", "reply-body");
    textarea.id = textareaId;
    textarea.name = "reply";
    textarea.rows = 3;
    textarea.maxLength = MESSAGE_LIMIT;
    textarea.required = true;
    textarea.value = savedDraft?.body || "";
    textarea.setAttribute("aria-describedby", counterId);

    const footer = makeElement("div", "reply-footer");
    const counter = makeElement(
      "span",
      "reply-count",
      `${textarea.value.length} / ${MESSAGE_LIMIT}`,
    );
    counter.id = counterId;
    counter.dataset.messageCount = "";
    const actions = makeElement("div", "reply-actions");
    const cancel = makeElement("button", "text-button", "Cancel");
    cancel.type = "button";
    const submit = makeElement("button", "button button-small", "Sign in & post");
    submit.type = "submit";
    submit.dataset.replySubmit = "";
    submit.dataset.signedInLabel = "Post reply";
    actions.append(cancel, submit);
    footer.append(counter, actions);

    const status = makeElement("p", "form-status");
    status.dataset.messageStatus = "";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    textarea.addEventListener("input", () => {
      delete form.dataset.requestId;
      clearPendingReplyIfChanged(parentMessage.id, textarea.value, nameInput.value);
      replyDrafts.set(parentMessage.id, {
        body: textarea.value,
        authorName: nameInput.value,
        open: true,
        requestId: "",
      });
      updateCounter(form, textarea);
    });
    nameInput.addEventListener("input", () => {
      delete form.dataset.requestId;
      clearPendingReplyIfChanged(parentMessage.id, textarea.value, nameInput.value);
      nameInput.removeAttribute("aria-invalid");
      replyDrafts.set(parentMessage.id, {
        body: textarea.value,
        authorName: nameInput.value,
        open: true,
        requestId: "",
      });
    });
    cancel.addEventListener("click", () => {
      clearPendingReplyIfChanged(parentMessage.id);
      replyDrafts.delete(parentMessage.id);
      textarea.value = "";
      nameInput.value = "";
      updateCounter(form, textarea);
      form.hidden = true;
      const toggle = document.querySelector(`[aria-controls="${formId}"]`);
      if (toggle) {
        toggle.setAttribute("aria-expanded", "false");
        toggle.focus();
      }
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitReply(form, parentMessage.id);
    });

    form.append(label, nameField, textarea, footer, status);
    if (replySubmitPromises.has(parentMessage.id)) {
      setFormBusy(form, true);
    }
    return form;
  }

  function buildEditImageController(message, form) {
    if (message.parent_id !== null) {
      return null;
    }

    const initialImagePath = IMAGE_PATH_PATTERN.test(message.image_path || "")
      ? message.image_path
      : null;
    const inputId = `edit-image-${message.id}`;
    const noteId = `edit-image-note-${message.id}`;
    const statusId = `edit-image-status-${message.id}`;
    const field = makeElement("div", "image-upload-field board-edit-image-field");
    const label = makeElement("label", "", initialImagePath ? "Replace image" : "Image (optional)");
    label.htmlFor = inputId;
    const note = makeElement(
      "p",
      "image-upload-note",
      initialImagePath
        ? "Choose a new JPEG, PNG, or WebP image, or remove the current image. Maximum 5 MB."
        : "Choose a JPEG, PNG, or WebP image. Maximum 5 MB.",
    );
    note.id = noteId;
    const input = document.createElement("input");
    input.id = inputId;
    input.name = "image";
    input.type = "file";
    input.accept = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
    input.setAttribute("aria-describedby", `${noteId} ${statusId}`);

    const preview = makeElement("div", "image-preview");
    const previewImage = document.createElement("img");
    previewImage.alt = "Image selected for this message";
    previewImage.referrerPolicy = "no-referrer";
    const previewDetails = document.createElement("div");
    const summary = makeElement("p", "", "Current image");
    previewDetails.append(summary);
    preview.append(previewImage, previewDetails);

    const toggle = makeElement("button", "text-button board-edit-image-action");
    toggle.type = "button";
    const imageStatus = makeElement("p", "form-status");
    imageStatus.id = statusId;
    imageStatus.setAttribute("role", "status");
    imageStatus.setAttribute("aria-live", "polite");
    field.append(label, note, input, preview, toggle, imageStatus);

    let selectedFile = null;
    let selectedDimensions = null;
    let selectedPreviewUrl = "";
    let removeExisting = false;
    let selectionRevision = 0;
    let selectionPromise = null;
    let selectionError = "";
    let locked = false;

    const revokePreview = () => {
      if (selectedPreviewUrl) {
        URL.revokeObjectURL(selectedPreviewUrl);
        selectedPreviewUrl = "";
      }
    };

    const render = () => {
      if (selectedFile && selectedPreviewUrl) {
        previewImage.src = selectedPreviewUrl;
        const dimensions = selectedDimensions
          ? `${selectedDimensions.width} x ${selectedDimensions.height} - `
          : "";
        summary.textContent = `${selectedFile.name} - ${dimensions}${fileSizeLabel(selectedFile.size)}`;
        preview.hidden = false;
        toggle.hidden = false;
        toggle.textContent = initialImagePath ? "Cancel replacement" : "Remove selected image";
      } else if (initialImagePath && !removeExisting) {
        previewImage.src = publicImageUrl(initialImagePath);
        summary.textContent = "Current image";
        preview.hidden = false;
        toggle.hidden = false;
        toggle.textContent = "Remove image";
      } else {
        previewImage.removeAttribute("src");
        preview.hidden = true;
        toggle.hidden = !initialImagePath;
        toggle.textContent = "Keep current image";
      }
      input.disabled = locked || form.getAttribute("aria-busy") === "true";
      toggle.disabled = locked || form.getAttribute("aria-busy") === "true";
    };

    const clearSelectedFile = () => {
      selectionRevision += 1;
      selectedFile = null;
      selectedDimensions = null;
      selectionError = "";
      input.value = "";
      revokePreview();
    };

    const reset = () => {
      clearSelectedFile();
      removeExisting = false;
      locked = false;
      setStatus(imageStatus, "");
      render();
    };

    const selectFile = async (file) => {
      const revision = ++selectionRevision;
      selectionError = "";
      if (!file) {
        clearSelectedFile();
        removeExisting = false;
        setStatus(imageStatus, "");
        render();
        return;
      }
      if (!IMAGE_TYPES.has(file.type)) {
        input.value = "";
        selectionError = "Choose a JPEG, PNG, or WebP image.";
        setStatus(imageStatus, selectionError, "error");
        render();
        return;
      }
      if (file.size < 1 || file.size > IMAGE_LIMIT) {
        input.value = "";
        selectionError = "Choose an image no larger than 5 MB.";
        setStatus(imageStatus, selectionError, "error");
        render();
        return;
      }

      setStatus(imageStatus, "Checking image...");
      input.disabled = true;
      let dimensions;
      try {
        dimensions = await imageDimensions(file);
      } catch {
        if (revision === selectionRevision) {
          input.value = "";
          selectionError = "The selected file is not a readable image.";
          setStatus(imageStatus, selectionError, "error");
          render();
        }
        return;
      }
      if (revision !== selectionRevision) {
        return;
      }
      if (
        dimensions.width < 1 ||
        dimensions.height < 1 ||
        dimensions.width > IMAGE_SIDE_LIMIT ||
        dimensions.height > IMAGE_SIDE_LIMIT ||
        dimensions.width * dimensions.height > IMAGE_PIXEL_LIMIT
      ) {
        input.value = "";
        selectionError = "Choose an image with fewer than 40 million pixels.";
        setStatus(imageStatus, selectionError, "error");
        render();
        return;
      }

      revokePreview();
      selectedFile = file;
      selectedDimensions = dimensions;
      selectedPreviewUrl = URL.createObjectURL(file);
      removeExisting = false;
      selectionError = "";
      setStatus(imageStatus, "Replacement image ready to upload.", "success");
      render();
    };

    input.addEventListener("change", () => {
      const task = selectFile(input.files?.[0] || null).finally(() => {
        if (selectionPromise === task) {
          selectionPromise = null;
        }
      });
      selectionPromise = task;
    });
    toggle.addEventListener("click", () => {
      if (selectedFile) {
        clearSelectedFile();
        removeExisting = false;
      } else if (initialImagePath) {
        removeExisting = !removeExisting;
      }
      selectionError = "";
      setStatus(
        imageStatus,
        removeExisting ? "The current image will be removed when you save." : "",
      );
      render();
    });

    reset();
    return {
      element: field,
      initialImagePath,
      async settle() {
        while (selectionPromise) {
          await selectionPromise;
        }
        if (selectionError) {
          throw new Error(selectionError);
        }
      },
      selectedFile: () => selectedFile,
      desiredExistingPath: () => (removeExisting ? null : initialImagePath),
      reset,
      setLocked(value) {
        locked = Boolean(value);
        render();
      },
      focus() {
        input.focus();
      },
    };
  }

  function buildEditForm(message, bodyElement, editButton, attachmentElement = null) {
    const form = makeElement("form", "board-edit-form");
    form.id = `edit-form-${message.id}`;
    const textareaId = `edit-body-${message.id}`;
    const counterId = `edit-count-${message.id}`;
    form.hidden = true;
    form.dataset.editMessageId = message.id;

    const label = makeElement("label", "reply-label", "Edit message");
    label.htmlFor = textareaId;
    const textarea = makeElement("textarea", "reply-body");
    textarea.id = textareaId;
    textarea.name = "body";
    textarea.rows = 4;
    textarea.maxLength = MESSAGE_LIMIT;
    textarea.required = true;
    textarea.value = message.body || "";
    textarea.setAttribute("aria-describedby", counterId);

    const footer = makeElement("div", "reply-footer");
    const counter = makeElement(
      "span",
      "reply-count",
      `${textarea.value.length} / ${MESSAGE_LIMIT}`,
    );
    counter.id = counterId;
    counter.dataset.messageCount = "";
    const actions = makeElement("div", "reply-actions");
    const cancel = makeElement("button", "text-button", "Cancel");
    cancel.type = "button";
    const save = makeElement("button", "button button-small", "Save edit");
    save.type = "submit";
    actions.append(cancel, save);
    footer.append(counter, actions);

    const status = makeElement("p", "form-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    const imageController = buildEditImageController(message, form);
    let editRequestId = "";
    let replacementImagePath = "";
    let replacementFile = null;
    let replacementUploaded = false;

    const close = async () => {
      if (replacementImagePath) {
        const uncertainImagePath = replacementImagePath;
        setStatus(status, "Discarding the unfinished replacement image...");
        let session;
        try {
          session = await getValidSession();
        } catch (error) {
          setStatus(status, error.message || "Sign in again to discard the replacement.", "error");
          return false;
        }
        if (!session || !await deleteUnlinkedImage(replacementImagePath, session)) {
          setStatus(
            status,
            "The replacement may already be attached. Press Save edit again to verify before canceling.",
            "error",
          );
          return false;
        }
        replacementImagePath = "";
        replacementFile = null;
        replacementUploaded = false;
        editRequestId = "";
        // A prior edit response may have been lost after the database commit.
        // Reload before closing so a linked replacement is never hidden behind
        // stale message data even when Storage correctly refused to delete it.
        try {
          const { roots, replies } = await getBoardMessages();
          const latestMessage = [...roots, ...replies]
            .find((entry) => entry.id === message.id);
          if (latestMessage?.image_path === uncertainImagePath) {
            await loadBoard(message.id, true);
            return true;
          }
        } catch {
          // The normal board refresh will reconcile the view later.
        }
      }
      form.hidden = true;
      bodyElement.hidden = false;
      if (attachmentElement) {
        attachmentElement.hidden = false;
      }
      textarea.value = message.body || "";
      updateCounter(form, textarea);
      imageController?.reset();
      setStatus(status, "");
      editButton.setAttribute("aria-expanded", "false");
      editButton.focus();
      return true;
    };

    textarea.addEventListener("input", () => updateCounter(form, textarea));
    cancel.addEventListener("click", () => {
      if (messageMutationPromises.has(message.id)) {
        setStatus(status, "This message is already being updated.");
        return;
      }
      const task = (async () => {
        setFormBusy(form, true);
        try {
          return await close();
        } finally {
          setFormBusy(form, false);
          imageController?.setLocked(Boolean(replacementImagePath));
        }
      })();
      messageMutationPromises.set(message.id, task);
      void task.finally(() => {
        if (messageMutationPromises.get(message.id) === task) {
          messageMutationPromises.delete(message.id);
        }
      });
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = textarea.value.trim();
      if (!body || body.length > MESSAGE_LIMIT) {
        setStatus(status, `Enter a message between 1 and ${MESSAGE_LIMIT} characters.`, "error");
        textarea.focus();
        return;
      }
      if (messageMutationPromises.has(message.id)) {
        setStatus(status, "This message is already being updated.");
        return;
      }

      const task = (async () => {
        setFormBusy(form, true);
        setStatus(status, "Saving edit…");
        await imageController?.settle();
        const session = await getValidSession();
        if (!session) {
          throw new Error("Sign in again to edit this message.");
        }

        const imageFile = imageController?.selectedFile() || null;
        let desiredImagePath = imageController
          ? imageController.desiredExistingPath()
          : message.image_path || null;
        if (imageFile) {
          if (replacementFile && replacementFile !== imageFile) {
            throw new Error("Retry or cancel the unfinished image replacement first.");
          }
          if (!replacementImagePath) {
            setStatus(status, "Preparing replacement image...");
            editRequestId = createRequestId();
            const reservation = await callPrepareImageUpload(
              editRequestId,
              imageFile.type,
              session,
            );
            replacementImagePath = reservation.imagePath;
            replacementFile = imageFile;
            replacementUploaded = reservation.alreadyConsumed;
          }
          if (!replacementUploaded) {
            setStatus(status, "Uploading replacement image...");
            await uploadImage(imageFile, replacementImagePath, session);
            replacementUploaded = true;
          }
          desiredImagePath = replacementImagePath;
        }

        setStatus(status, "Saving edit...");
        await callUpdateMessage(
          message.id,
          body,
          imageFile ? editRequestId : null,
          desiredImagePath,
          session,
        );
        replacementImagePath = "";
        replacementFile = null;
        replacementUploaded = false;
        editRequestId = "";
        await processServerImageCleanupQueue(currentSession || session);
        await loadBoard(message.id, true);
        setBoardStatus(
          boardPermissionWarning
            ? `Message edited. ${boardPermissionWarning}`
            : "Message edited.",
          boardPermissionWarning ? "error" : "success",
        );
      })();
      messageMutationPromises.set(message.id, task);
      try {
        await task;
      } catch (error) {
        if (replacementImagePath && !error.postOutcomeAmbiguous) {
          try {
            const session = await getValidSession();
            if (session && await deleteUnlinkedImage(replacementImagePath, session)) {
              replacementImagePath = "";
              replacementFile = null;
              replacementUploaded = false;
              editRequestId = "";
            }
          } catch {
            // Keep the same reservation for an explicit retry or cancel.
          }
        }
        setStatus(status, error.message || "The edit could not be saved.", "error");
        setFormBusy(form, false);
        imageController?.setLocked(Boolean(replacementImagePath));
        if (error.message?.toLowerCase().includes("image")) {
          imageController?.focus();
        } else {
          textarea.focus();
        }
      } finally {
        if (messageMutationPromises.get(message.id) === task) {
          messageMutationPromises.delete(message.id);
        }
      }
    });

    form.append(label, textarea);
    if (imageController) {
      form.append(imageController.element);
    }
    form.append(footer, status);
    editButton.addEventListener("click", () => {
      const otherEdit = boardList.querySelector(
        `.board-edit-form:not([hidden]):not([data-edit-message-id="${message.id}"])`,
      );
      if (otherEdit) {
        setBoardStatus("Save or cancel the current edit before editing another message.");
        otherEdit.querySelector("textarea")?.focus();
        return;
      }
      form.hidden = false;
      bodyElement.hidden = true;
      if (attachmentElement) {
        attachmentElement.hidden = true;
      }
      editButton.setAttribute("aria-expanded", "true");
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
    return form;
  }

  async function deleteRenderedMessage(message, replyCount, button) {
    if (messageMutationPromises.has(message.id)) {
      return;
    }
    const openEdit = boardList.querySelector(".board-edit-form:not([hidden])");
    if (openEdit && openEdit.dataset.editMessageId !== message.id) {
      setBoardStatus("Save or cancel the current edit before deleting another message.");
      openEdit.querySelector("textarea")?.focus();
      return;
    }
    const willTombstone = !message.parent_id && replyCount > 0;
    const prompt = willTombstone
      ? "This message has replies. Delete it and keep a (Deleted message) placeholder?"
      : "Delete this message permanently?";
    if (!window.confirm(prompt)) {
      return;
    }

    button.disabled = true;
    const task = (async () => {
      const session = await getValidSession();
      if (!session) {
        throw new Error("Sign in again to delete this message.");
      }
      const result = await callDeleteMessage(message.id, session);
      let imageRemoved = true;
      if (result.image_path) {
        imageRemoved = await deleteUnlinkedImage(result.image_path, currentSession || session);
        if (!imageRemoved) {
          queueImageCleanup(result.image_path, session.user?.id || "");
        } else if (!await confirmServerImageCleanup(result.image_path, currentSession || session)) {
          imageRemoved = false;
        }
      }
      const focusId = result.deletion_mode === "tombstoned"
        ? message.id
        : message.parent_id || "";
      await loadBoard(focusId, true);
      setBoardStatus(
        `${imageRemoved
          ? result.deletion_mode === "tombstoned"
            ? "Message deleted; its replies were preserved."
            : "Message deleted."
          : "Message deleted. Its detached image cleanup will retry automatically."}${
          boardPermissionWarning ? ` ${boardPermissionWarning}` : ""
        }`,
        imageRemoved && !boardPermissionWarning ? "success" : "error",
      );
      if (!focusId) {
        const status = document.querySelector("[data-board-status]");
        if (status) {
          status.tabIndex = -1;
          status.focus();
        }
      }
    })();
    messageMutationPromises.set(message.id, task);
    try {
      await task;
    } catch (error) {
      setBoardStatus(error.message || "The message could not be deleted.", "error");
      button.disabled = false;
      button.focus();
    } finally {
      if (messageMutationPromises.get(message.id) === task) {
        messageMutationPromises.delete(message.id);
      }
    }
  }

  function buildMessage(message, replies = [], isReply = false) {
    const item = makeElement("li", isReply ? "board-reply" : "board-message-item");
    const article = makeElement("article", isReply ? "board-message board-message-reply" : "board-message");
    article.id = `message-${message.id}`;
    article.tabIndex = -1;
    article.append(makeMessageMeta(message));
    const deleted = Boolean(message.deleted_at);
    const body = makeElement(
      "p",
      deleted ? "board-message-body board-message-body--deleted" : "board-message-body",
      deleted ? "(Deleted message)" : message.body || "",
    );
    article.append(body);
    let attachment = null;
    if (!isReply && !deleted) {
      attachment = makeImageAttachment(message);
      if (attachment) {
        article.append(attachment);
      }
    }

    let replyButton = null;
    let replyForm = null;
    const permission = boardPermissions.get(message.id) || {};
    if (!deleted && (!isReply || permission.canEdit || permission.canDelete)) {
      const controls = makeElement("div", "board-message-actions");
      controls.setAttribute("role", "group");
      controls.setAttribute("aria-label", `Actions for message by ${message.author_name || "Google user"}`);
      if (!isReply) {
        replyButton = makeElement("button", "text-button reply-toggle", "Reply");
        replyForm = buildReplyForm(message);
        replyButton.type = "button";
        replyButton.setAttribute("aria-expanded", String(!replyForm.hidden));
        replyButton.setAttribute("aria-controls", replyForm.id);
        replyButton.addEventListener("click", () => {
          const willOpen = replyForm.hidden;
          replyForm.hidden = !willOpen;
          replyButton.setAttribute("aria-expanded", String(willOpen));
          if (willOpen) {
            const textarea = replyForm.querySelector("textarea");
            const nameInput = replyForm.querySelector("[data-message-author-name]");
            replyDrafts.set(message.id, {
              body: textarea.value,
              authorName: nameInput?.value || "",
              open: true,
              requestId: replyForm.dataset.requestId || "",
            });
            textarea.focus();
          } else {
            const draft = replyDrafts.get(message.id);
            if (draft) {
              draft.open = false;
            }
          }
        });
        controls.append(replyButton);
      }
      if (permission.canEdit) {
        const editButton = makeElement("button", "text-button", "Edit");
        editButton.type = "button";
        editButton.dataset.messageMutation = "";
        editButton.setAttribute("aria-expanded", "false");
        const editForm = buildEditForm(message, body, editButton, attachment);
        editButton.setAttribute("aria-controls", editForm.id);
        controls.append(editButton);
        article.append(controls, editForm);
      } else {
        article.append(controls);
      }
      if (permission.canDelete) {
        const deleteButton = makeElement("button", "text-button text-button-danger", "Delete");
        deleteButton.type = "button";
        deleteButton.dataset.messageMutation = "";
        deleteButton.addEventListener("click", () => {
          void deleteRenderedMessage(message, replies.length, deleteButton);
        });
        controls.append(deleteButton);
      }
    }

    if (!isReply) {
      if (replyForm) {
        article.append(replyForm);
      }

      if (replies.length) {
        const replyList = makeElement("ol", "reply-list");
        replyList.setAttribute("aria-label", `Replies to ${message.author_name}`);
        replies.forEach((reply) => replyList.append(buildMessage(reply, [], true)));
        article.append(replyList);
      }
    }

    item.append(article);
    return item;
  }

  function focusRenderedMessage(messageId) {
    const targetId = messageId || (
      window.location.hash.startsWith("#message-")
        ? window.location.hash.slice("#message-".length)
        : ""
    );
    if (!UUID_PATTERN.test(targetId)) {
      return;
    }

    const target = document.getElementById(`message-${targetId}`);
    if (target) {
      target.scrollIntoView({ block: "center" });
      target.focus({ preventScroll: true });
    }
  }

  function renderBoard(roots, replies, focusId = "") {
    const focusedReplyForm = document.activeElement?.closest?.("[data-reply-parent-id]");
    const focusedReplyParentId = focusedReplyForm?.dataset.replyParentId || "";
    const repliesByParent = new Map();
    replies.forEach((reply) => {
      if (!repliesByParent.has(reply.parent_id)) {
        repliesByParent.set(reply.parent_id, []);
      }
      repliesByParent.get(reply.parent_id).push(reply);
    });

    boardList.replaceChildren();
    roots.forEach((message) => {
      boardList.append(buildMessage(message, repliesByParent.get(message.id) || []));
    });

    const emptyNote = document.querySelector("[data-board-empty]");
    if (emptyNote) {
      emptyNote.hidden = roots.length !== 0;
    }
    updateAuthUI();
    window.requestAnimationFrame(() => {
      if (focusedReplyParentId) {
        const replyForm = document.querySelector(
          `[data-reply-parent-id="${focusedReplyParentId}"]`,
        );
        const textarea = replyForm?.querySelector("textarea");
        if (textarea && !textarea.disabled) {
          textarea.focus({ preventScroll: true });
          return;
        }
      }
      focusRenderedMessage(focusId);
    });
  }

  async function loadBoard(focusId = "", force = false) {
    if (!isBoardPage) {
      return;
    }
    if (!force && boardList.querySelector(".board-edit-form:not([hidden])")) {
      setBoardStatus("Save or cancel the open edit before refreshing.");
      return;
    }
    if (boardLoadPromise) {
      await boardLoadPromise;
      if (focusId || force) {
        return loadBoard(focusId, force);
      }
      return;
    }

    document.querySelectorAll("[data-board-refresh]").forEach((button) => {
      button.disabled = true;
    });
    setBoardStatus("Loading messages…");

    let loadError = null;
    const loadTask = (async () => {
      try {
        const [{ roots, replies }, permissions] = await Promise.all([
          getBoardMessages(),
          getBoardPermissions(),
        ]);
        boardPermissions = permissions;
        renderBoard(roots, replies, focusId);
        setBoardStatus(boardPermissionWarning, boardPermissionWarning ? "error" : "");
        lastBoardLoad = Date.now();
      } catch (error) {
        loadError = error;
        setBoardStatus(error.message || "Messages could not be loaded.", "error");
      } finally {
        document.querySelectorAll("[data-board-refresh]").forEach((button) => {
          button.disabled = false;
        });
      }
    })();
    boardLoadPromise = loadTask.finally(() => {
      boardLoadPromise = null;
    });
    await boardLoadPromise;
    if (force && loadError) {
      throw loadError;
    }
  }

  async function submitReply(form, parentId) {
    const textarea = form.querySelector("textarea");
    const nameInput = form.querySelector("[data-message-author-name]");
    const status = form.querySelector("[data-message-status]");
    const body = textarea.value.trim();
    const authorName = normalizeAuthorName(nameInput?.value || "");

    if (!body || body.length > MESSAGE_LIMIT) {
      setStatus(status, `Enter a reply between 1 and ${MESSAGE_LIMIT} characters.`, "error");
      textarea.focus();
      return;
    }
    const nameError = authorNameError(authorName);
    if (nameError) {
      nameInput?.setAttribute("aria-invalid", "true");
      setStatus(status, nameError, "error");
      nameInput?.focus();
      return;
    }
    nameInput?.removeAttribute("aria-invalid");

    if (replySubmitPromises.has(parentId)) {
      setStatus(status, "This reply is already being posted.");
      return;
    }

    const requestId = UUID_PATTERN.test(form.dataset.requestId || "")
      ? form.dataset.requestId
      : createRequestId();
    form.dataset.requestId = requestId;
    replyDrafts.set(parentId, { body, authorName, open: true, requestId });
    setFormBusy(form, true);
    setStatus(status, "Posting your reply…");

    const task = (async () => {
      let session;
      try {
        session = await getValidSession();
      } catch (error) {
        setStatus(status, error.message, "error");
        return;
      }

      if (!session) {
        if (!savePendingMessage(body, authorName, parentId, requestId)) {
          setStatus(status, "Allow session storage in this browser to continue.", "error");
          return;
        }
        await startGoogleSignIn({ keepPending: true, statusElement: status });
        return;
      }

      const message = await callCreateMessage(
        body,
        parentId,
        requestId,
        session,
        null,
        authorName,
      );
      replyDrafts.delete(parentId);
      const pending = readPendingMessage();
      if (pending?.requestId === requestId) {
        removeStorage(window.sessionStorage, PENDING_KEY);
      }
      textarea.value = "";
      if (nameInput) {
        nameInput.value = "";
      }
      updateCounter(form, textarea);
      setStatus(status, "Reply posted.", "success");
      await loadBoard(message.id);
    })();
    replySubmitPromises.set(parentId, task);

    try {
      await task;
    } catch (error) {
      const currentStatus = document
        .getElementById(`reply-form-${parentId}`)
        ?.querySelector("[data-message-status]") || status;
      setStatus(currentStatus, error.message || "The reply could not be posted.", "error");
    } finally {
      if (replySubmitPromises.get(parentId) === task) {
        replySubmitPromises.delete(parentId);
      }
      const currentForm = document.getElementById(`reply-form-${parentId}`) || form;
      setFormBusy(currentForm, false);
      updateAuthUI();
    }
  }

  async function processPendingMessage() {
    if (!isBoardPage) {
      return;
    }

    const pending = readPendingMessage();
    if (!pending) {
      return;
    }

    if (pending.parentId) {
      replyDrafts.set(pending.parentId, {
        body: pending.body,
        authorName: pending.authorName,
        open: true,
        requestId: pending.requestId,
      });
    }

    let session;
    try {
      session = await getValidSession();
    } catch (error) {
      setBoardStatus(error.message, "error");
      return;
    }
    if (!session) {
      return;
    }

    let pendingReplyTask = null;
    if (pending.parentId) {
      const existingReplyTask = replySubmitPromises.get(pending.parentId);
      if (existingReplyTask) {
        await existingReplyTask;
        return;
      }
      pendingReplyTask = Promise.resolve();
      replySubmitPromises.set(pending.parentId, pendingReplyTask);
      const replyForm = document.getElementById(`reply-form-${pending.parentId}`);
      if (replyForm) {
        setFormBusy(replyForm, true);
      }
    }

    const operation = async () => {
      setBoardStatus("Posting your saved message…");
      try {
        const message = await callCreateMessage(
          pending.body,
          pending.parentId,
          pending.requestId,
          session,
          null,
          pending.authorName,
        );
        removeStorage(window.sessionStorage, PENDING_KEY);
        if (pending.parentId === null) {
          const latestDraft = readDraft();
          const latestName = normalizeAuthorName(readDraftAuthorName());
          if (
            latestDraft.trim() === pending.body.trim() &&
            latestName === normalizeAuthorName(pending.authorName)
          ) {
            resetTopLevelRequest();
            syncTopLevelDraft("");
          }
        } else {
          const draft = replyDrafts.get(pending.parentId);
          if (draft?.requestId === pending.requestId) {
            replyDrafts.delete(pending.parentId);
          }
        }
        await loadBoard(message.id);
        setBoardStatus(pending.parentId ? "Reply posted." : "Message posted.", "success");
      } catch (error) {
        if (pending.parentId === null) {
          syncTopLevelDraft(pending.body, pending.authorName);
        }
        setBoardStatus(error.message || "Your saved message could not be posted.", "error");
      }
    };

    try {
      if (pending.parentId) {
        const task = operation();
        replySubmitPromises.set(pending.parentId, task);
        pendingReplyTask = task;
        await task;
      } else {
        await withTopLevelSubmitLock(
          document.querySelector("[data-board-status]"),
          operation,
        );
      }
    } finally {
      if (
        pending.parentId &&
        replySubmitPromises.get(pending.parentId) === pendingReplyTask
      ) {
        replySubmitPromises.delete(pending.parentId);
      }
      if (pending.parentId) {
        const replyForm = document.getElementById(`reply-form-${pending.parentId}`);
        if (replyForm) {
          setFormBusy(replyForm, false);
        }
      }
      updateAuthUI();
    }
  }

  function initializeBoardControls() {
    document.querySelectorAll("[data-board-refresh]").forEach((button) => {
      button.addEventListener("click", () => void loadBoard());
    });

    if (!isBoardPage) {
      return;
    }

    window.setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        !boardList.contains(document.activeElement)
      ) {
        void loadBoard();
      }
    }, BOARD_REFRESH_MS);

    document.addEventListener("visibilitychange", () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastBoardLoad > BOARD_REFRESH_MS &&
        !boardList.contains(document.activeElement)
      ) {
        void loadBoard();
      }
    });
  }

  Object.defineProperty(window, "JiwonBoardAuth", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      getSession(forceRefresh = false) {
        if (authCallbackInProgress) return Promise.resolve(null);
        return getValidSession(Boolean(forceRefresh));
      },
      signInForPuzzle(statusElement = null) {
        const redirectUrl = new URL(window.location.href);
        redirectUrl.hash = "puzzle-game";
        ["code", "error", "error_code", "error_description"].forEach((name) => {
          redirectUrl.searchParams.delete(name);
        });
        return startGoogleSignIn({ statusElement, redirectUrl });
      },
    }),
  });

  async function initialize() {
    initializeTitleCrepe();
    initializeSealCompanion();
    currentSession = authCallbackInProgress ? null : readSession();
    unresolvedImageIntent = readImageIntent();
    initializeTopLevelForms();
    initializeImageUpload();
    showImageIntent(unresolvedImageIntent);
    initializeAuthActions();
    initializeBoardControls();
    updateAuthUI();

    const pendingAtStart = isBoardPage ? readPendingMessage() : null;
    if (pendingAtStart) {
      setTopLevelFormsBusy(true);
      if (pendingAtStart.parentId) {
        replyDrafts.set(pendingAtStart.parentId, {
          body: pendingAtStart.body,
          authorName: pendingAtStart.authorName,
          open: true,
          requestId: pendingAtStart.requestId,
        });
      }
    }

    let authNotice = null;
    try {
      const message = await handleAuthCallback();
      if (message) {
        authNotice = { message, tone: "success" };
      }
    } catch (error) {
      if (authCallbackInProgress) clearSession();
      authNotice = {
        message: error.message || "Google sign-in could not be completed.",
        tone: "error",
      };
    } finally {
      authCallbackInProgress = false;
    }

    try {
      currentSession = await getValidSession();
    } catch (error) {
      authNotice = { message: error.message, tone: "error" };
    }
    updateAuthUI();

    if (authNotice && !isBoardPage) {
      window.dispatchEvent(new CustomEvent("jiwon-auth-result", {
        detail: authNotice,
      }));
    }

    if (isBoardPage) {
      if (
        unresolvedImageIntent &&
        currentSession?.user?.id === unresolvedImageIntent.userId
      ) {
        await recoverImageIntent(unresolvedImageIntent, currentSession);
      }
      if (!lastBoardLoad) {
        await loadBoard();
      }
      if (currentSession) {
        void processImageCleanupQueue(currentSession);
        void processServerImageCleanupQueue(currentSession);
      }
      if (unresolvedImageIntent && currentSession) {
        setBoardStatus(
          currentSession.user?.id === unresolvedImageIntent.userId
            ? "The earlier image post still has an uncertain result. Use Retry image post."
            : "An unfinished image post belongs to another account. Sign in with that account to recover it.",
          "error",
        );
      }
      await processPendingMessage();
      if (authNotice && (!pendingAtStart || authNotice.tone === "error")) {
        setBoardStatus(authNotice.message, authNotice.tone);
      }
      if (!topLevelSubmitPromise) {
        setTopLevelFormsBusy(false);
        updateAuthUI();
      }
    }
  }

  window.addEventListener("storage", (event) => {
    if (event.key === SESSION_KEY) {
      sessionRevision += 1;
      const storedSession = readSession();
      if (!storedSession && (selectedImage || imageSelectionPromise)) {
        clearSelectedImage("Sign in again, then choose the image again.", "error");
      }
      currentSession = storedSession;
      updateAuthUI();
      if (isBoardPage && !boardList.contains(document.activeElement)) {
        void loadBoard("", true).catch(() => {});
      }
    } else if (event.key === IMAGE_INTENT_KEY) {
      unresolvedImageIntent = readImageIntent();
      if (unresolvedImageIntent) {
        imageSelectionRevision += 1;
        selectedImage = null;
        revokeImagePreview();
        const elements = imageElements();
        if (elements.input) {
          elements.input.value = "";
        }
        if (elements.previewImage) {
          elements.previewImage.removeAttribute("src");
        }
        if (elements.preview) {
          elements.preview.hidden = true;
        }
        showImageIntent(unresolvedImageIntent);
      } else if (!selectedImage) {
        clearSelectedImage();
      }
      updateAuthUI();
    }
  });

  window.addEventListener("pageshow", (event) => {
    if (!event.persisted || !signInStarting) return;
    signInStarting = false;
    updateAuthUI();
  });

  void initialize();
})();
