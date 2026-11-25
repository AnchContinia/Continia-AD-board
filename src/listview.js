// List view: every card as a flat, scrollable masonry grid, grouped like the rings.
// Thumbnails reuse the canvases the 3D scene already drew; each is encoded to an
// image only when its tile comes near the viewport.

const PROVIDER_LABEL = { youtube: 'YouTube', vimeo: 'Vimeo', file: 'Videofil' };



function kindLabel(d) {
  return d.type === 'image' ? 'Billede' : `Video · ${PROVIDER_LABEL[d.provider] || 'Video'}`;
}

export class ListView {
  constructor(root, { onOpen } = {}) {
    this.root = root;
    this.inner = root.querySelector('.listview__inner');
    this.onOpen = onOpen;
    this.tiles = new Map(); // card -> tile element
    this.sections = [];
    this.built = false;
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        this.observer.unobserve(entry.target);
        this.fill(entry.target);
      }
    }, { root, rootMargin: '600px 0px' });
  }

  build(cards) {
    if (this.built) return;
    this.built = true;

    const groups = new Map();
    for (const card of cards) {
      const name = card.data.group || 'Moodboard';
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(card);
    }

    for (const [name, list] of groups) {
      const section = document.createElement('section');
      section.className = 'listgroup';
      const head = document.createElement('header');
      head.className = 'listgroup__head';
      const h = document.createElement('h2');
      h.textContent = name;
      const count = document.createElement('span');
      count.className = 'listgroup__count';
      head.append(h, count);
      const grid = document.createElement('div');
      grid.className = 'listgrid';
      section.append(head, grid);

      for (const card of list) {
        const tile = this.makeTile(card);
        grid.append(tile);
        this.tiles.set(card, tile);
        this.observer.observe(tile);
      }
      this.sections.push({ section, count, cards: list });
      this.inner.append(section);
    }
  }

  makeTile(card) {
    const d = card.data;
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tile is-loading';
    tile.dataset.type = d.type;
    tile.setAttribute('aria-label', `${d.type === 'image' ? 'Billede' : 'Video'}: ${d.title}`);
    tile.card = card;

    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    tile.append(img);

    if (d.type === 'video') {
      const play = document.createElement('span');
      play.className = 'tile__play';
      const icon = document.createElement('i');
      icon.className = 'fa-light fa-play';
      icon.setAttribute('aria-hidden', 'true');
      play.append(icon);
      tile.append(play);
    }

    const cap = document.createElement('span');
    cap.className = 'tile__cap';
    cap.setAttribute('aria-hidden', 'true');
    const kind = document.createElement('span');
    kind.className = 'tile__kind';
    kind.textContent = kindLabel(d);
    const title = document.createElement('span');
    title.className = 'tile__title';
    title.textContent = d.title;
    cap.append(kind, title);
    tile.append(cap);

    tile.addEventListener('click', () => this.onOpen?.(card));
    return tile;
  }

  // Called by the tile observer, and again by the scene when a thumbnail lands.
  fill(tile) {
    const card = tile.card;
    if (tile.filled) return;
    const canvas = card.mat?.uniforms.uMap.value?.image;
    if (!card.loaded || !canvas) {
      tile.wanted = true; // cardLoaded() fills it once the scene has drawn it
      return;
    }
    tile.filled = true;
    tile.style.aspectRatio = String(card.mat.uniforms.uAspect.value || 1);
    const img = tile.querySelector('img');
    const done = (blob) => {
      if (!blob) return;
      img.addEventListener('load', () => tile.classList.remove('is-loading'), { once: true });
      img.src = URL.createObjectURL(blob);
    };
    // WebP keeps transparent logos transparent; browsers without it fall back to PNG.
    canvas.toBlob(done, 'image/webp', 0.86);
  }

  cardLoaded(card) {
    const tile = this.tiles.get(card);
    if (tile?.wanted) this.fill(tile);
  }

  cardFailed(card) {
    const tile = this.tiles.get(card);
    if (tile) tile.hidden = true;
  }

  applyFilter(matches) {
    for (const { section, count, cards } of this.sections) {
      let n = 0;
      for (const card of cards) {
        const show = matches(card);
        this.tiles.get(card).hidden = !show;
        if (show) n++;
      }
      section.hidden = n === 0;
      count.textContent = String(n);
    }
  }
}
