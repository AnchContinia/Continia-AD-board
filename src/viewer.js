// The viewer: one image or video on the scrim, with prev/next and close.

import { motion } from './motion.js';

const PROVIDER_LABEL = { youtube: 'YouTube', vimeo: 'Vimeo', file: 'Videofil' };

export class Viewer {
  constructor(root, { onClose, onStep } = {}) {
    this.root = root;
    this.popup = root.querySelector('.popup');
    this.body = root.querySelector('.popup__body');
    this.label = root.querySelector('.popup__label');
    this.count = root.querySelector('[data-count]');
    this.kind = root.querySelector('[data-kind]');
    this.original = root.querySelector('[data-original]');
    this.closeBtn = root.querySelector('[data-close]');
    this.onClose = onClose;
    this.onStep = onStep;
    this.isOpen = false;
    this.closeTimer = 0;

    this.closeBtn.addEventListener('click', () => this.close());
    root.querySelector('.viewer__scrim').addEventListener('click', () => this.close());
    root.querySelector('[data-prev]').addEventListener('click', () => this.onStep?.(-1));
    root.querySelector('[data-next]').addEventListener('click', () => this.onStep?.(1));

    document.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.onStep?.(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.onStep?.(1);
      } else if (e.key === 'Tab') {
        this.trapFocus(e);
      }
    });
  }

  open(data, index, total) {
    clearTimeout(this.closeTimer);
    this.lastFocus = document.activeElement;
    this.isOpen = true;
    this.root.hidden = false;
    this.root.classList.remove('is-closing');
    // Next frame so the entrance transition runs from its start state.
    requestAnimationFrame(() => this.root.classList.add('is-open'));
    this.show(data, index, total);
    this.closeBtn.focus({ preventScroll: true });
  }

  show(data, index, total) {
    this.label.textContent = data.title;
    this.count.textContent = `${index + 1} / ${total}`;
    const parts = data.type === 'image' ? ['Billede'] : ['Video', PROVIDER_LABEL[data.provider] || 'Video'];
    if (data.group && data.group !== 'Video') parts.push(data.group);
    this.kind.textContent = parts.join(' · ');
    this.original.href = data.url || data.src;
    this.original.textContent = data.type === 'image' ? 'Åbn original' : `Åbn på ${PROVIDER_LABEL[data.provider] || 'kilden'}`;
    this.body.replaceChildren(this.media(data));

    // Replay the entrance on every step, not just the first open.
    this.popup.classList.remove('is-entering');
    void this.popup.offsetWidth;
    this.popup.classList.add('is-entering');
  }

  media(d) {
    if (d.type === 'image') {
      const img = document.createElement('img');
      img.alt = d.title;
      img.decoding = 'async';
      img.className = 'is-loading';
      img.addEventListener('load', () => img.classList.remove('is-loading'), { once: true });
      img.src = d.src;
      return img;
    }

    const frame = document.createElement('div');
    frame.className = 'frame16x9';

    if (d.embed) {
      const iframe = document.createElement('iframe');
      iframe.src = d.embed;
      iframe.title = d.title;
      iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.append(iframe);
    } else {
      const video = document.createElement('video');
      video.src = d.src;
      video.controls = true;
      video.autoplay = true;
      video.playsInline = true;
      frame.append(video);
    }
    return frame;
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('is-open');
    this.root.classList.add('is-closing');
    this.closeTimer = setTimeout(() => {
      this.root.hidden = true;
      this.root.classList.remove('is-closing');
      this.body.replaceChildren(); // stops any playing video
    }, motion.duration.base);
    if (this.lastFocus && typeof this.lastFocus.focus === 'function') {
      this.lastFocus.focus({ preventScroll: true });
    }
    this.onClose?.();
  }

  trapFocus(e) {
    const focusables = [...this.root.querySelectorAll('button, a[href], iframe, video')]
      .filter((el) => !el.hidden && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
