(() => {
  "use strict";

  const SIZE = 6;
  const TILE_COUNT = SIZE * SIZE;
  const EMPTY = TILE_COUNT - 1;
  const BOARD_VERSION = 4;
  const PENDING_KEY = "jiwon-puzzle-pending-score-v4";
  const LEGACY_PENDING_KEYS = [
    "jiwon-puzzle-pending-score-v1",
    "jiwon-puzzle-pending-score-v2",
    "jiwon-puzzle-pending-score-v3",
  ];
  const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
  const MAX_MOVES = 20000;
  const SUPABASE_URL = "https://atdqvkkpnupphxrdoawq.supabase.co";
  const PUBLISHABLE_KEY = "sb_publishable_lZGnDkxBcFxOOVeJziTGjQ_UrI7FuzV";

  const gallery = document.querySelector("[data-puzzle-gallery]");
  const game = document.querySelector("[data-puzzle-game]");
  const board = document.querySelector("[data-puzzle-board]");
  if (!gallery || !game || !board) return;

  const playArea = game.querySelector(".puzzle-play-area");
  const nameOutput = game.querySelector("[data-puzzle-name]");
  const movesOutput = game.querySelector("[data-puzzle-moves]");
  const statusOutput = game.querySelector("[data-puzzle-status]");
  const shuffleButton = game.querySelector("[data-puzzle-shuffle]");
  const resetButton = game.querySelector("[data-puzzle-reset]");
  const changeButton = game.querySelector("[data-puzzle-change]");
  const referenceImage = game.querySelector("[data-puzzle-reference]");
  const testChoiceItem = gallery.querySelector("[data-puzzle-test-choice]");
  const testBadge = game.querySelector("[data-puzzle-test-badge]");
  const completion = game.querySelector("[data-puzzle-completion]");
  const completionTitle = completion?.querySelector("h4");
  const completionSummary = game.querySelector("[data-puzzle-completion-summary]");
  const recordMoves = game.querySelector("[data-puzzle-record-moves]");
  const scoreForm = game.querySelector("[data-puzzle-score-form]");
  const playerNameInput = game.querySelector("[data-puzzle-player-name]");
  const emailConsentInput = game.querySelector("[data-puzzle-email-consent]");
  const scoreConsent = game.querySelector("[data-puzzle-score-consent]");
  const submitButton = game.querySelector("[data-puzzle-submit]");
  const playAgainButton = game.querySelector("[data-puzzle-play-again]");
  const scoreStatus = game.querySelector("[data-puzzle-score-status]");

  const testModeEnabled = new URL(window.location.href).searchParams.get("puzzle-test") === "1";
  if (testChoiceItem) testChoiceItem.hidden = !testModeEnabled;
  try {
    LEGACY_PENDING_KEYS.forEach((key) => window.sessionStorage.removeItem(key));
  } catch { /* ignored */ }

  let currentChoice = null;
  let imageSource = "";
  let imageName = "";
  let imageKey = "";
  let state = solvedState();
  let startingState = state.slice();
  let moves = 0;
  let solved = false;
  let completionPresented = false;
  let isAnimating = false;
  let animationToken = 0;
  let movePath = [];
  let scoreDraft = null;
  let gameEpoch = 0;
  let registrationActionPromise = null;
  let registrationPromise = null;
  let recoveryPromise = null;
  let completionRevealTimer = null;
  let completionRevealCleanup = null;
  let activeChallengeRequestId = null;
  let puzzleReady = false;
  let puzzleLoading = false;

  function solvedState() {
    return Array.from({ length: TILE_COUNT }, (_, index) => index);
  }

  function oneMoveState() {
    const candidate = solvedState();
    swap(candidate, TILE_COUNT - 2, TILE_COUNT - 1);
    return candidate;
  }

  function isSolved(candidate) {
    return candidate.every((tile, index) => tile === index);
  }

  function isValidState(candidate) {
    return Array.isArray(candidate) && candidate.length === TILE_COUNT &&
      new Set(candidate).size === TILE_COUNT &&
      candidate.every((tile) => Number.isInteger(tile) && tile >= 0 && tile < TILE_COUNT);
  }

  function isSolvableState(candidate) {
    if (!isValidState(candidate)) return false;
    let inversions = 0;
    for (let first = 0; first < candidate.length; first += 1) {
      if (candidate[first] === EMPTY) continue;
      for (let second = first + 1; second < candidate.length; second += 1) {
        if (candidate[second] !== EMPTY && candidate[first] > candidate[second]) inversions += 1;
      }
    }
    const emptyRowFromBottom = SIZE - Math.floor(candidate.indexOf(EMPTY) / SIZE);
    return (inversions + emptyRowFromBottom) % 2 === 1;
  }

  function statesMatch(first, second) {
    return isValidState(first) && isValidState(second) &&
      first.every((tile, index) => tile === second[index]);
  }

  function pathSolvesState(initialState, path) {
    if (!isValidState(initialState) || typeof path !== "string" || !/^[UDLR]{1,20000}$/.test(path)) {
      return false;
    }
    const candidate = initialState.slice();
    for (const direction of path) {
      const emptyIndex = candidate.indexOf(EMPTY);
      const row = Math.floor(emptyIndex / SIZE);
      const column = emptyIndex % SIZE;
      if ((direction === "U" && row === 0) || (direction === "D" && row === SIZE - 1) ||
          (direction === "L" && column === 0) || (direction === "R" && column === SIZE - 1)) {
        return false;
      }
      const targetIndex = direction === "U" ? emptyIndex - SIZE
        : direction === "D" ? emptyIndex + SIZE
          : direction === "L" ? emptyIndex - 1
            : emptyIndex + 1;
      swap(candidate, emptyIndex, targetIndex);
    }
    return isSolved(candidate);
  }

  function adjacentIndices(index) {
    const row = Math.floor(index / SIZE);
    const column = index % SIZE;
    const adjacent = [];
    if (row > 0) adjacent.push(index - SIZE);
    if (row < SIZE - 1) adjacent.push(index + SIZE);
    if (column > 0) adjacent.push(index - 1);
    if (column < SIZE - 1) adjacent.push(index + 1);
    return adjacent;
  }

  function swap(candidate, first, second) {
    [candidate[first], candidate[second]] = [candidate[second], candidate[first]];
  }

  function randomIndex(limit) {
    if (window.crypto?.getRandomValues) {
      const maximum = Math.floor(0x100000000 / limit) * limit;
      const value = new Uint32Array(1);
      do window.crypto.getRandomValues(value); while (value[0] >= maximum);
      return value[0] % limit;
    }
    return Math.floor(Math.random() * limit);
  }

  function randomPracticeState(avoid = null) {
    while (true) {
      const candidate = solvedState();
      for (let index = candidate.length - 1; index > 0; index -= 1) {
        swap(candidate, index, randomIndex(index + 1));
      }

      if (!isSolvableState(candidate)) {
        const nonEmpty = candidate
          .map((tile, index) => tile === EMPTY ? -1 : index)
          .filter((index) => index >= 0);
        swap(candidate, nonEmpty[0], nonEmpty[1]);
      }

      const misplaced = candidate.reduce(
        (count, tile, index) => count + (tile === index ? 0 : 1),
        0,
      );
      if (!isSolved(candidate) && misplaced >= 30 && !statesMatch(candidate, avoid)) {
        return candidate;
      }
    }
  }

  function requestId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const bytes = window.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return [...bytes].map((byte, index) =>
      `${[4, 6, 8, 10].includes(index) ? "-" : ""}${byte.toString(16).padStart(2, "0")}`,
    ).join("");
  }

  function moveCountLabel(count) {
    return `${count} ${count === 1 ? "move" : "moves"}`;
  }

  function setStatus(message, { visible = false, tone = "" } = {}) {
    if (!statusOutput) return;
    statusOutput.textContent = message;
    statusOutput.classList.toggle("visually-hidden", !visible);
    if (tone) statusOutput.dataset.tone = tone;
    else delete statusOutput.dataset.tone;
  }

  function setPuzzleBusy(busy) {
    puzzleLoading = busy;
    game.setAttribute("aria-busy", busy ? "true" : "false");
    board.setAttribute("aria-disabled", busy || !puzzleReady ? "true" : "false");
    if (resetButton) resetButton.disabled = busy || !puzzleReady;
    if (shuffleButton) shuffleButton.disabled = busy;
    if (playAgainButton) playAgainButton.disabled = busy;
  }

  function setScoreStatus(message, tone = "") {
    if (!scoreStatus) return;
    scoreStatus.textContent = message;
    if (tone) scoreStatus.dataset.tone = tone;
    else delete scoreStatus.dataset.tone;
  }

  function updateCompletionRecord() {
    if (completionSummary) completionSummary.textContent = `You completed ${imageName}.`;
    if (recordMoves) recordMoves.textContent = String(moves);
  }

  function setScoreFormBusy(busy) {
    scoreForm?.setAttribute("aria-busy", busy ? "true" : "false");
    if (playerNameInput) playerNameInput.disabled = busy;
    if (emailConsentInput) emailConsentInput.disabled = busy;
    if (submitButton) {
      submitButton.disabled = busy;
      submitButton.textContent = busy ? "Adding…" : "Add to leaderboard";
    }
  }

  function cancelCompletionReveal() {
    if (completionRevealTimer !== null) window.clearTimeout(completionRevealTimer);
    completionRevealTimer = null;
    completionRevealCleanup?.();
    completionRevealCleanup = null;
  }

  function clearCompletion() {
    cancelCompletionReveal();
    completionPresented = false;
    scoreDraft = null;
    board.classList.remove("puzzle-board--solved");
    playArea?.classList.remove("puzzle-play-area--solved");
    if (completion) completion.hidden = true;
    if (scoreForm) scoreForm.hidden = false;
    if (playerNameInput) {
      playerNameInput.disabled = false;
      playerNameInput.removeAttribute("aria-invalid");
    }
    if (emailConsentInput) {
      emailConsentInput.disabled = false;
      emailConsentInput.checked = false;
    }
    setScoreFormBusy(false);
    setScoreStatus("");
  }

  function render(animation = null) {
    let animatedTile = null;
    board.classList.toggle("puzzle-board--solved", solved && completionPresented);
    board.replaceChildren();

    if (solved && completionPresented) {
      solvedState().forEach((tile) => {
        const piece = document.createElement("span");
        piece.className = `puzzle-merged-piece puzzle-column-${tile % SIZE} puzzle-row-${Math.floor(tile / SIZE)}`;
        piece.setAttribute("aria-hidden", "true");
        const pieceImage = document.createElement("img");
        pieceImage.src = imageSource;
        pieceImage.alt = "";
        pieceImage.draggable = false;
        piece.append(pieceImage);
        board.append(piece);
      });

      const finishedImage = document.createElement("img");
      finishedImage.className = "puzzle-solved-image";
      finishedImage.src = imageSource;
      finishedImage.alt = "";
      finishedImage.draggable = false;
      const banner = document.createElement("span");
      banner.className = "puzzle-solved-banner";
      banner.textContent = "Congratulations!";
      banner.setAttribute("aria-hidden", "true");
      board.append(finishedImage, banner);
    } else {
      state.forEach((tile, position) => {
        if (tile === EMPTY) {
          const empty = document.createElement("span");
          empty.className = "puzzle-empty";
          empty.setAttribute("aria-hidden", "true");
          board.append(empty);
          return;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = `puzzle-tile puzzle-column-${tile % SIZE} puzzle-row-${Math.floor(tile / SIZE)}`;
        if (animation && tile === animation.tile && position === animation.toPosition) {
          button.classList.add("puzzle-tile--moving", animation.className);
          animatedTile = button;
        }
        button.dataset.tile = String(tile);
        button.tabIndex = -1;
        button.setAttribute(
          "aria-label",
          `Move puzzle piece at row ${Math.floor(position / SIZE) + 1}, column ${(position % SIZE) + 1}`,
        );
        const image = document.createElement("img");
        image.src = imageSource;
        image.alt = "";
        image.draggable = false;
        button.append(image);
        board.append(button);
      });
    }

    if (movesOutput) movesOutput.textContent = String(moves);
    if (solved) board.setAttribute("aria-label", `Completed ${imageName} sliding puzzle.`);
    else {
      const emptyIndex = state.indexOf(EMPTY);
      board.setAttribute("aria-label", `${SIZE} by ${SIZE} sliding puzzle. Use arrow keys to move the empty space. Empty space at row ${Math.floor(emptyIndex / SIZE) + 1}, column ${(emptyIndex % SIZE) + 1}.`);
    }
    return animatedTile;
  }

  function slideClass(fromPosition, toPosition) {
    if (fromPosition === toPosition - SIZE) return "puzzle-slide-from-above";
    if (fromPosition === toPosition + SIZE) return "puzzle-slide-from-below";
    if (fromPosition === toPosition - 1) return "puzzle-slide-from-left";
    return "puzzle-slide-from-right";
  }

  function moveDirection(tileIndex, emptyIndex) {
    if (tileIndex === emptyIndex - SIZE) return "U";
    if (tileIndex === emptyIndex + SIZE) return "D";
    if (tileIndex === emptyIndex - 1) return "L";
    return "R";
  }

  function cancelMoveAnimation() {
    animationToken += 1;
    isAnimating = false;
  }

  function animateMove(tile, onComplete) {
    const token = ++animationToken;
    let finished = false;
    isAnimating = true;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (token !== animationToken) return;
      isAnimating = false;
      onComplete();
    };
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    tile.addEventListener("animationend", finish, { once: true });
    window.setTimeout(finish, 300);
  }

  function showCompletion({ focus = true } = {}) {
    updateCompletionRecord();
    playArea?.classList.add("puzzle-play-area--solved");
    if (completion) completion.hidden = false;
    const isTest = Boolean(currentChoice?.hasAttribute("data-puzzle-test"));
    const isPractice = !isTest && !scoreDraft;
    if (scoreForm) scoreForm.hidden = isTest || isPractice;
    if (isTest) {
      setScoreStatus("Test records are never added to the leaderboard.");
    } else if (isPractice) {
      setScoreStatus("This local practice puzzle cannot be added to the leaderboard. Press Play again after the leaderboard server is ready to start a ranked puzzle.");
    } else {
      if (scoreConsent) scoreConsent.textContent = `Add this record to the public ${imageName} leaderboard? Your chosen name and moves will be public.`;
      setScoreStatus("Nothing is posted until you choose Add to leaderboard. If you are signed out, this record will stay in this tab while you sign in with Google.");
    }
    if (focus) completionTitle?.focus();
  }

  function finalizeSolvedRun() {
    if (solved || !isSolved(state)) return;
    solved = true;
    scoreDraft = activeChallengeRequestId ? Object.freeze({
      requestId: activeChallengeRequestId,
      imageKey,
      boardVersion: BOARD_VERSION,
      moves,
      movePath: movePath.join(""),
    }) : null;
    setStatus(scoreDraft
      ? `Solved in ${moveCountLabel(moves)}.`
      : `Practice puzzle solved in ${moveCountLabel(moves)}.`);
  }

  function presentSolvedState() {
    if (!solved || completionPresented) return;
    completionPresented = true;
    playArea?.classList.add("puzzle-play-area--solved");
    render();
    const epoch = gameEpoch;
    const reveal = () => {
      cancelCompletionReveal();
      if (epoch === gameEpoch && solved && completionPresented) showCompletion();
    };
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      reveal();
      return;
    }
    const onAnimationEnd = (event) => {
      if (event.target === board && event.animationName === "puzzle-complete-merge") reveal();
    };
    board.addEventListener("animationend", onAnimationEnd);
    completionRevealCleanup = () => board.removeEventListener("animationend", onAnimationEnd);
    completionRevealTimer = window.setTimeout(reveal, 1050);
  }

  function moveTile(tileIndex) {
    if (!puzzleReady || puzzleLoading || solved || isAnimating) return;
    const emptyIndex = state.indexOf(EMPTY);
    if (!adjacentIndices(emptyIndex).includes(tileIndex)) return;
    const movingTile = state[tileIndex];
    movePath.push(moveDirection(tileIndex, emptyIndex));
    swap(state, emptyIndex, tileIndex);
    moves += 1;
    const completesPuzzle = isSolved(state);
    const animatedTile = render({
      tile: movingTile,
      toPosition: emptyIndex,
      className: slideClass(tileIndex, emptyIndex),
    });
    if (completesPuzzle) finalizeSolvedRun();
    else setStatus(`Move ${moves}.`);
    board.focus({ preventScroll: true });
    if (animatedTile) animateMove(animatedTile, () => completesPuzzle && presentSolvedState());
    else if (completesPuzzle) presentSolvedState();
  }

  function moveEmpty(direction) {
    const emptyIndex = state.indexOf(EMPTY);
    const row = Math.floor(emptyIndex / SIZE);
    const column = emptyIndex % SIZE;
    let tileIndex = -1;
    if (direction === "up" && row > 0) tileIndex = emptyIndex - SIZE;
    if (direction === "down" && row < SIZE - 1) tileIndex = emptyIndex + SIZE;
    if (direction === "left" && column > 0) tileIndex = emptyIndex - 1;
    if (direction === "right" && column < SIZE - 1) tileIndex = emptyIndex + 1;
    if (tileIndex >= 0) moveTile(tileIndex);
  }

  function beginState(candidate) {
    cancelMoveAnimation();
    clearCompletion();
    state = candidate.slice();
    startingState = candidate.slice();
    moves = 0;
    solved = false;
    movePath = [];
    render();
    board.focus({ preventScroll: true });
  }

  function validateChallenge(value, expectedRequestId) {
    if (!value || value.request_id !== expectedRequestId || value.image_key !== imageKey ||
        value.board_version !== BOARD_VERSION || !isValidState(value.start_board) ||
        !isSolvableState(value.start_board) || isSolved(value.start_board)) return null;
    return value.start_board.slice();
  }

  async function prepareSelectedPuzzle() {
    const epoch = ++gameEpoch;
    const isTest = currentChoice?.hasAttribute("data-puzzle-test");
    activeChallengeRequestId = null;
    puzzleReady = false;
    cancelMoveAnimation();
    clearCompletion();

    if (isTest) {
      activeChallengeRequestId = null;
      puzzleReady = true;
      beginState(oneMoveState());
      if (shuffleButton) shuffleButton.textContent = "Restart test";
      setPuzzleBusy(false);
      setStatus("One-move test ready. Move the puzzle piece beside the empty space.");
      return true;
    }

    const challengeRequestId = requestId();
    setPuzzleBusy(true);
    if (shuffleButton) shuffleButton.textContent = "Shuffling…";
    board.replaceChildren();
    board.setAttribute("aria-label", "Creating a new random puzzle.");
    setStatus("Creating a new random puzzle…", { visible: true });

    try {
      const challenge = firstRow(await callRpc("create_puzzle_challenge", {
        p_image_key: imageKey,
        p_board_version: BOARD_VERSION,
        p_request_id: challengeRequestId,
      }));
      if (epoch !== gameEpoch) return false;
      const challengeState = validateChallenge(challenge, challengeRequestId);
      if (!challengeState) throw new Error("The puzzle server returned an invalid random board. Please try again.");
      activeChallengeRequestId = challengeRequestId;
      puzzleReady = true;
      beginState(challengeState);
      setStatus("Puzzle ready. Sign-in is only needed if you choose to add your completed score.");
      return true;
    } catch (error) {
      if (epoch !== gameEpoch) return false;
      activeChallengeRequestId = null;
      puzzleReady = true;
      beginState(randomPracticeState(startingState));
      setStatus("Leaderboard server unavailable. A local random practice puzzle is ready; this round cannot be added to the leaderboard.", {
        visible: true,
        tone: "",
      });
      return true;
    } finally {
      if (epoch === gameEpoch) {
        if (shuffleButton) shuffleButton.textContent = "Shuffle";
        setPuzzleBusy(false);
      }
    }
  }

  function startPuzzle(choice) {
    currentChoice = choice;
    imageSource = choice.dataset.puzzleImage || "";
    imageName = choice.dataset.puzzleName || "Selected image";
    imageKey = choice.dataset.puzzleKey || "";
    if (!imageSource || !imageKey) return;
    if (nameOutput) nameOutput.textContent = imageName;
    if (referenceImage) {
      referenceImage.src = imageSource;
      referenceImage.alt = `Completed ${imageName} puzzle`;
    }
    if (testBadge) testBadge.hidden = !choice.hasAttribute("data-puzzle-test");
    gallery.hidden = true;
    game.hidden = false;
    void prepareSelectedPuzzle();
  }

  function startRandomPuzzle() {
    const choices = Array.from(gallery.querySelectorAll("[data-puzzle-image]:not([data-puzzle-test])"));
    if (choices.length) startPuzzle(choices[randomIndex(choices.length)]);
  }

  function reset() {
    if (!puzzleReady || puzzleLoading) return;
    cancelMoveAnimation();
    clearCompletion();
    state = startingState.slice();
    moves = 0;
    solved = false;
    movePath = [];
    render();
    setStatus(currentChoice?.hasAttribute("data-puzzle-test") ? "One-move test reset." : "Puzzle reset.");
    board.focus({ preventScroll: true });
  }

  function chooseAnotherImage() {
    gameEpoch += 1;
    cancelMoveAnimation();
    clearCompletion();
    activeChallengeRequestId = null;
    puzzleReady = false;
    setPuzzleBusy(false);
    if (shuffleButton) shuffleButton.textContent = "Shuffle";
    game.hidden = true;
    gallery.hidden = false;
    currentChoice = null;
    gallery.querySelector("[data-puzzle-random]")?.focus();
  }

  function authApi() {
    return window.JiwonBoardAuth || null;
  }

  async function validSession(forceRefresh = false) {
    try {
      return await authApi()?.getSession?.(forceRefresh) || null;
    } catch {
      return null;
    }
  }

  async function parseResponse(response) {
    const text = await response.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return { message: text }; }
  }

  function rpcError(response, payload, rpcName = "") {
    if (response.status === 404 || payload?.code === "PGRST202") {
      if (rpcName === "create_puzzle_challenge") {
        return new Error("Random puzzle creation is not active on the server yet. Please try again after setup is complete.");
      }
      return new Error("Leaderboard registration is not active on the server yet. Please try again after the site owner finishes setup.");
    }
    if (response.status === 429) {
      return new Error(rpcName === "create_puzzle_challenge"
        ? "Too many puzzle requests. Please wait and press Shuffle again."
        : "Too many score requests. Please wait and try again.");
    }
    return new Error(typeof payload?.message === "string"
      ? payload.message
      : rpcName === "create_puzzle_challenge"
        ? "The random puzzle could not be created. Press Shuffle to try again."
        : "The score could not be registered.");
  }

  async function callRpc(name, body, requireAuth = false) {
    let session = await validSession(false);
    if (requireAuth && !session) throw new Error("Google sign-in is required to register a score.");
    const send = async (activeSession) => {
      let response;
      try {
        const headers = { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" };
        if (activeSession?.accessToken) headers.Authorization = `Bearer ${activeSession.accessToken}`;
        response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
      } catch {
        throw new Error(name === "create_puzzle_challenge"
          ? "Could not reach the puzzle server. Check your connection and press Shuffle again."
          : "Could not reach the leaderboard. Please try again.");
      }
      return { response, payload: await parseResponse(response) };
    };
    let result = await send(session);
    if (result.response.status === 401 && session) {
      session = await validSession(true);
      if (session) result = await send(session);
    }
    if (!result.response.ok) throw rpcError(result.response, result.payload, name);
    return result.payload;
  }

  function firstRow(payload) {
    return Array.isArray(payload) ? payload[0] || null : payload;
  }

  function validateSubmissionResult(value, pending) {
    const rank = value?.leaderboard_rank;
    const validRank = rank === null || rank === undefined || (
      Number.isSafeInteger(Number(rank)) && Number(rank) >= 1
    );
    if (!value || typeof value.submission_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.submission_id) ||
        value.image_key !== pending.imageKey || value.player_name !== pending.playerName ||
        Number(value.moves) !== pending.moves || value.email_published !== true ||
        typeof value.is_personal_best !== "boolean" ||
        typeof value.already_registered !== "boolean" || !validRank) return null;
    return value;
  }

  function isKnownImageKey(key) {
    if (typeof key !== "string" || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(key)) return false;
    return Array.from(gallery.querySelectorAll("[data-puzzle-key]:not([data-puzzle-test])"))
      .some((choice) => choice.dataset.puzzleKey === key);
  }

  function validatePending(value) {
    const pendingNameLength = typeof value?.playerName === "string"
      ? Array.from(value.playerName).length
      : 0;
    const pendingNameBytes = typeof value?.playerName === "string"
      ? new TextEncoder().encode(value.playerName).length
      : 0;
    if (!value || value.version !== 4 || typeof value.requestId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId) ||
        !isKnownImageKey(value.imageKey) || value.boardVersion !== BOARD_VERSION ||
        !isValidState(value.startingBoard) || !isSolvableState(value.startingBoard) ||
        isSolved(value.startingBoard) ||
        typeof value.playerName !== "string" || value.playerName !== value.playerName.trim() ||
        pendingNameLength < 1 || pendingNameLength > 40 || pendingNameBytes > 160 ||
        value.playerName.includes("@") || /[\u0000-\u001f\u007f]/.test(value.playerName) ||
        typeof value.movePath !== "string" || !/^[UDLR]{1,20000}$/.test(value.movePath) ||
        value.moves !== value.movePath.length || !pathSolvesState(value.startingBoard, value.movePath) ||
        value.publishEmail !== true || !Number.isFinite(value.createdAt) ||
        Date.now() - value.createdAt > PENDING_TTL_MS || value.createdAt > Date.now() + 60000) return null;
    return Object.freeze(value);
  }

  function readPendingScore() {
    try {
      const pending = validatePending(JSON.parse(window.sessionStorage.getItem(PENDING_KEY) || "null"));
      if (!pending) window.sessionStorage.removeItem(PENDING_KEY);
      return pending;
    } catch {
      try { window.sessionStorage.removeItem(PENDING_KEY); } catch { /* ignored */ }
      return null;
    }
  }

  function writePendingScore(pending) {
    try {
      window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
      return true;
    } catch {
      return false;
    }
  }

  function clearPendingScore(expectedRequestId) {
    const pending = readPendingScore();
    if (!pending || pending.requestId !== expectedRequestId) return;
    try { window.sessionStorage.removeItem(PENDING_KEY); } catch { /* ignored */ }
  }

  async function submitPendingScore(pending) {
    if (registrationPromise) return registrationPromise;
    const isDisplayed = () => Boolean(
      scoreDraft?.requestId === pending.requestId &&
      scoreDraft?.imageKey === pending.imageKey &&
      scoreDraft?.boardVersion === pending.boardVersion &&
      scoreDraft?.movePath === pending.movePath &&
      playerNameInput?.value.trim() === pending.playerName,
    );
    const task = (async () => {
      let submissionFailed = false;
      if (isDisplayed()) {
        setScoreFormBusy(true);
        setScoreStatus("Adding your record…");
      }
      try {
        const result = validateSubmissionResult(firstRow(await callRpc("submit_puzzle_score", {
          p_image_key: pending.imageKey,
          p_board_version: pending.boardVersion,
          p_player_name: pending.playerName,
          p_move_path: pending.movePath,
          p_request_id: pending.requestId,
          p_publish_email: true,
        }, true)), pending);
        if (!result) throw new Error("The score response was incomplete.");
        clearPendingScore(pending.requestId);
        const rank = Number(result.leaderboard_rank);
        if (isDisplayed()) {
          const resultMessage = result.already_registered === true
            ? `This completed record was already registered as ${result.player_name || pending.playerName}${Number.isFinite(rank) ? ` · Rank #${rank}` : ""}.`
            : `Added as ${pending.playerName}${Number.isFinite(rank) ? ` · Rank #${rank}` : ""}. Your name now links to your public Google email.`;
          setScoreStatus(resultMessage, "success");
          if (scoreForm) scoreForm.hidden = true;
          scoreStatus?.focus();
        }
        return result;
      } catch (error) {
        submissionFailed = true;
        if (isDisplayed()) {
          setScoreStatus(error.message || "The score could not be registered.", "error");
        }
        throw error;
      } finally {
        if (isDisplayed()) {
          setScoreFormBusy(false);
          if (submissionFailed && !scoreForm?.hidden) submitButton?.focus();
        }
      }
    })();
    registrationPromise = task;
    try { return await task; } finally { if (registrationPromise === task) registrationPromise = null; }
  }

  async function registerCompletedScore(event) {
    event?.preventDefault();
    if (!scoreDraft || currentChoice?.hasAttribute("data-puzzle-test") || registrationActionPromise) return;
    const playerName = playerNameInput?.value.trim() || "";
    const nameLength = Array.from(playerName).length;
    const nameBytes = new TextEncoder().encode(playerName).length;
    if (nameLength < 1 || nameLength > 40 || nameBytes > 160 || /[\u0000-\u001f\u007f]/.test(playerName)) {
      playerNameInput?.setAttribute("aria-invalid", "true");
      setScoreStatus("Enter a public leaderboard name using 1–40 visible characters.", "error");
      playerNameInput?.focus();
      return;
    }
    if (playerName.includes("@")) {
      playerNameInput?.setAttribute("aria-invalid", "true");
      setScoreStatus("Use a public name, not an email address.", "error");
      playerNameInput?.focus();
      return;
    }
    if (!emailConsentInput?.checked) {
      setScoreStatus("Agree to publish your Google email as the contact link before registering.", "error");
      emailConsentInput?.focus();
      return;
    }
    playerNameInput?.removeAttribute("aria-invalid");
    const existing = readPendingScore();
    const fingerprintMatches = existing && existing.imageKey === scoreDraft.imageKey &&
      existing.boardVersion === scoreDraft.boardVersion && existing.movePath === scoreDraft.movePath &&
      existing.playerName === playerName && existing.publishEmail === true &&
      existing.requestId === scoreDraft.requestId && statesMatch(existing.startingBoard, startingState);
    if (existing && !fingerprintMatches) {
      setScoreStatus("A previous completed score is still saved in this tab. Reload this page to recover and register it before adding another score.", "error");
      return;
    }
    const pending = existing || Object.freeze({
      version: 4,
      requestId: scoreDraft.requestId,
      imageKey: scoreDraft.imageKey,
      boardVersion: scoreDraft.boardVersion,
      startingBoard: startingState.slice(),
      playerName,
      movePath: scoreDraft.movePath,
      moves: scoreDraft.moves,
      publishEmail: true,
      createdAt: Date.now(),
    });
    if (!writePendingScore(pending)) {
      setScoreStatus("Allow session storage so this score can survive Google sign-in.", "error");
      return;
    }
    const task = (async () => {
      setScoreFormBusy(true);
      const session = await validSession(false);
      if (!session) {
        setScoreStatus("Your completed record is saved in this tab. Opening Google sign-in…");
        const api = authApi();
        if (!api?.signInForPuzzle) {
          throw new Error("Google sign-in is still loading. Please press Add to leaderboard again.");
        }
        await api.signInForPuzzle(scoreStatus);
        return;
      }
      await submitPendingScore(pending);
    })();
    registrationActionPromise = task;
    try {
      await task;
    } catch (error) {
      setScoreStatus(error.message || "Google sign-in could not be started. Your record is still saved in this tab.", "error");
    } finally {
      if (registrationActionPromise === task) registrationActionPromise = null;
      if (!registrationPromise && !scoreForm?.hidden) setScoreFormBusy(false);
    }
  }

  async function recoverPendingScore() {
    if (recoveryPromise) return recoveryPromise;
    if (registrationActionPromise) return registrationActionPromise;
    if (registrationPromise) return registrationPromise;
    const pending = readPendingScore();
    if (!pending) return null;
    const task = (async () => {
      const shouldRestore = game.hidden || (
        solved && scoreDraft?.requestId === pending.requestId
      );
      const choice = shouldRestore
        ? Array.from(gallery.querySelectorAll("[data-puzzle-key]:not([data-puzzle-test])"))
          .find((candidate) => candidate.dataset.puzzleKey === pending.imageKey)
        : null;
      if (choice && shouldRestore) {
        gameEpoch += 1;
        cancelMoveAnimation();
        currentChoice = choice;
        imageSource = choice.dataset.puzzleImage || "";
        imageName = choice.dataset.puzzleName || "Selected image";
        imageKey = pending.imageKey;
        state = solvedState();
        startingState = pending.startingBoard.slice();
        activeChallengeRequestId = pending.requestId;
        puzzleReady = true;
        puzzleLoading = false;
        moves = pending.moves;
        movePath = pending.movePath.split("");
        solved = true;
        completionPresented = true;
        scoreDraft = Object.freeze({
          requestId: pending.requestId,
          imageKey,
          boardVersion: pending.boardVersion,
          moves,
          movePath: pending.movePath,
        });
        if (nameOutput) nameOutput.textContent = imageName;
        if (referenceImage) {
          referenceImage.src = imageSource;
          referenceImage.alt = `Completed ${imageName} puzzle`;
        }
        if (testBadge) testBadge.hidden = true;
        if (playerNameInput) playerNameInput.value = pending.playerName;
        if (emailConsentInput) emailConsentInput.checked = true;
        gallery.hidden = true;
        game.hidden = false;
        setPuzzleBusy(false);
        playArea?.classList.add("puzzle-play-area--solved");
        render();
        showCompletion({ focus: false });
      }
      const session = await validSession(false);
      if (!session) {
        if (choice && shouldRestore) {
          setScoreStatus("This completed record is saved in this tab. Press Add to leaderboard to try Google sign-in again.");
        }
        return null;
      }
      if (choice && shouldRestore) setScoreStatus("Finishing score registration…");
      try { return await submitPendingScore(pending); } catch { return null; }
    })();
    recoveryPromise = task;
    try { return await task; } finally { if (recoveryPromise === task) recoveryPromise = null; }
  }

  gallery.addEventListener("click", (event) => {
    if (event.target.closest("[data-puzzle-random]")) startRandomPuzzle();
    else {
      const choice = event.target.closest("[data-puzzle-image]");
      if (choice) startPuzzle(choice);
    }
  });
  board.addEventListener("click", (event) => {
    const tile = event.target.closest("[data-tile]");
    if (tile && board.contains(tile)) moveTile(state.indexOf(Number(tile.dataset.tile)));
  });
  board.addEventListener("keydown", (event) => {
    const direction = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" }[event.key];
    if (!direction) return;
    event.preventDefault();
    moveEmpty(direction);
  });
  shuffleButton?.addEventListener("click", () => void prepareSelectedPuzzle());
  resetButton?.addEventListener("click", reset);
  changeButton?.addEventListener("click", chooseAnotherImage);
  playAgainButton?.addEventListener("click", () => void prepareSelectedPuzzle());
  scoreForm?.addEventListener("submit", registerCompletedScore);
  window.addEventListener("jiwon-auth-change", () => void recoverPendingScore());
  window.addEventListener("jiwon-auth-result", (event) => {
    const message = typeof event.detail?.message === "string" ? event.detail.message : "";
    if (message && readPendingScore()) setScoreStatus(message, event.detail?.tone || "");
  });
  window.addEventListener("pageshow", () => void recoverPendingScore());
  void recoverPendingScore();
})();
