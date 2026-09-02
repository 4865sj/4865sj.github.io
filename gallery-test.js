(() => {
  "use strict";

  const carousel = document.querySelector("[data-gallery-carousel]");

  if (carousel) {
    const slides = Array.from(carousel.querySelectorAll("[data-gallery-slide]"));
    const previousButton = carousel.querySelector("[data-gallery-previous]");
    const nextButton = carousel.querySelector("[data-gallery-next]");
    const counter = carousel.querySelector("[data-gallery-counter]");
    const status = carousel.querySelector("[data-gallery-status]");
    const swipeArea = carousel.querySelector("[data-gallery-swipe-area]");
    let activeIndex = 0;
    let pointerId = null;
    let pointerStartX = 0;
    let pointerStartY = 0;

    const ensureImageLoaded = (slide) => {
      const image = slide.querySelector("img[data-gallery-src]");

      if (!image) {
        return;
      }

      image.addEventListener(
        "error",
        () => {
          status.textContent = "This photo could not be loaded.";
        },
        { once: true }
      );

      image.src = image.dataset.gallerySrc;
      delete image.dataset.gallerySrc;
    };

    const showSlide = (requestedIndex, announce = true) => {
      const nextIndex = Math.max(0, Math.min(requestedIndex, slides.length - 1));

      if (nextIndex === activeIndex && announce) {
        return;
      }

      activeIndex = nextIndex;
      ensureImageLoaded(slides[activeIndex]);

      slides.forEach((slide, index) => {
        slide.hidden = index !== activeIndex;
      });

      previousButton.setAttribute("aria-disabled", String(activeIndex === 0));
      nextButton.setAttribute(
        "aria-disabled",
        String(activeIndex === slides.length - 1)
      );
      counter.textContent = `${activeIndex + 1} / ${slides.length}`;

      if (announce) {
        status.textContent = `Photo ${activeIndex + 1} of ${slides.length}.`;
      }
    };

    previousButton.addEventListener("click", () => {
      showSlide(activeIndex - 1);
    });

    nextButton.addEventListener("click", () => {
      showSlide(activeIndex + 1);
    });

    carousel.addEventListener("keydown", (event) => {
      const target = event.target;

      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        showSlide(activeIndex - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        showSlide(activeIndex + 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        showSlide(0);
      } else if (event.key === "End") {
        event.preventDefault();
        showSlide(slides.length - 1);
      }
    });

    swipeArea.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse") {
        return;
      }

      pointerId = event.pointerId;
      pointerStartX = event.clientX;
      pointerStartY = event.clientY;

      if (swipeArea.setPointerCapture) {
        swipeArea.setPointerCapture(pointerId);
      }
    });

    swipeArea.addEventListener("pointerup", (event) => {
      if (event.pointerId !== pointerId) {
        return;
      }

      const horizontalDistance = event.clientX - pointerStartX;
      const verticalDistance = event.clientY - pointerStartY;
      pointerId = null;

      if (
        Math.abs(horizontalDistance) < 50 ||
        Math.abs(horizontalDistance) <= Math.abs(verticalDistance)
      ) {
        return;
      }

      if (horizontalDistance < 0) {
        showSlide(activeIndex + 1);
      } else {
        showSlide(activeIndex - 1);
      }
    });

    swipeArea.addEventListener("pointercancel", () => {
      pointerId = null;
    });

    showSlide(0, false);
  }

  const previewSignIn = document.querySelector("[data-gallery-preview-sign-in]");
  const commentStatus = document.querySelector("[data-gallery-comment-status]");

  if (previewSignIn && commentStatus) {
    previewSignIn.addEventListener("click", () => {
      commentStatus.textContent =
        "Prototype only: Google sign-in and saved comments will be connected after the design is approved.";
    });
  }
})();
