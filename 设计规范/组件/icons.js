/* Original, consistent 24 × 24 line icons. No external icon dependency. */
const paths = {
  flower: '<path d="M12 12C3 11 5 2 9 4c2 1 3 5 3 8Zm0 0c1-9 10-7 8-3-1 2-5 3-8 3Zm0 0c9 1 7 10 3 8-2-1-3-5-3-8Zm0 0c-1 9-10 7-8 3 1-2 5-3 8-3Z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  type: '<path d="M3 5h13M9.5 5v15M18 10v10M15 10h6"/>',
  cursor: '<path d="m5 3 14 10-7 1-3 7L5 3Z"/>',
  sliders: '<path d="M4 6h16M4 12h16M4 18h16"/><rect x="7" y="3.5" width="3" height="5" rx="1"/><rect x="15" y="9.5" width="3" height="5" rx="1"/><rect x="6" y="15.5" width="3" height="5" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1"/>',
  route: '<circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M5 7v7a5 5 0 0 0 5 5h7M10 5h7a2 2 0 0 1 2 2v5"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 16 5-5 4 4 3-3 6 6"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
  book: '<path d="M12 6v15M3 4h5a4 4 0 0 1 4 3 4 4 0 0 1 4-3h5v15h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3V4Z"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  arrowUp: '<path d="M6 18 18 6M7 6h11v11"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  chevronRight: '<path d="m10 6 6 6-6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  circleCheck: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 14v6h16v-6"/>',
  cloud: '<path d="M6 17a5 5 0 0 1-1-9 7 7 0 0 1 13-1 5 5 0 0 1 1 10M12 21V10m-4 4 4-4 4 4"/>',
  file: '<path d="M14 3H5v18h14V8l-5-5Z"/><path d="M14 3v5h5M8 12h8M8 16h5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M7 14h2M12 14h2M7 17h2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
  home: '<path d="m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9"/>',
  settings: '<path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 3 3-1 2 3 3-1 1-3 3-1 2-3-2-2 1-3-3-3-3 1-2-3H9Z"/><circle cx="12" cy="12" r="3"/>',
  moon: '<path d="M20 14.5A9 9 0 0 1 9.5 4a9 9 0 1 0 10.5 10.5Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  chat: '<path d="M21 11a8 8 0 0 1-8 8H7l-4 3V6a3 3 0 0 1 3-3h10a5 5 0 0 1 5 5v3Z"/><path d="M7 8h10M7 12h7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.1"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/>',
  refresh: '<path d="M20 10a8 8 0 0 0-14-4L3 9m0-5v5h5M4 14a8 8 0 0 0 14 4l3-3m0 5v-5h-5"/>',
  play: '<path d="m8 4 12 8-12 8V4Z"/>',
  code: '<path d="m7 6-5 6 5 6m10-12 5 6-5 6m-3-15-4 18"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  inbox: '<path d="M3 13 6 4h12l3 9v7H3v-7Zm0 0h5l2 3h4l2-3h5"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8l10-5Zm-9 10 9 5 9-5M3 18l9 5 9-5"/>',
  github: '<path d="M9 19c-4 1-4-2-6-2m12 5v-4c0-1 .3-1.6.8-2.1 2.7-.3 5.5-1.3 5.5-6a4.8 4.8 0 0 0-1.3-3.3 4.4 4.4 0 0 0-.1-3.3s-1-.3-3.5 1.3a12 12 0 0 0-6.4 0C7.5 3 6.5 3.3 6.5 3.3a4.4 4.4 0 0 0-.1 3.3A4.8 4.8 0 0 0 5 10c0 4.7 2.8 5.7 5.5 6-.4.4-.7.9-.8 1.6V22"/>',
  link: '<path d="m10 13 4-4M8 15l-2 2a3 3 0 0 1-4-4l5-5a3 3 0 0 1 4 0m2 1 2-2a3 3 0 0 1 4 4l-5 5a3 3 0 0 1-4 0"/>',
};
export const iconNames = Object.keys(paths);
export function icon(name, extraClass = '') {
  return `<svg class="ui-icon ${extraClass}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
}
export function renderIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => {
    const template = document.createElement('template');
    template.innerHTML = icon(el.dataset.icon);
    el.replaceWith(template.content.firstElementChild);
  });
}
