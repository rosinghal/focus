const URL_PATTERN = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;

const linkDomain = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};

const titleParts = (text) => {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const domain = linkDomain(match[0]);
    if (!domain) continue;
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: domain, url: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
};

const linkNode = (text, url, onOpen) => {
  const node = Object.assign(document.createElement('span'), { className: 'title-link', textContent: text, title: url });
  if (!onOpen) return node;
  node.classList.add('clickable');
  node.setAttribute('role', 'link');
  node.tabIndex = 0;
  const open = (event) => {
    // The link sits inside a task <label>; without this the click also selects the task.
    event.preventDefault();
    event.stopPropagation();
    onOpen(url);
  };
  node.addEventListener('click', open);
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') open(event);
  });
  return node;
};

const titleNodes = (text, onOpen) =>
  titleParts(text).map(({ text: partText, url }) =>
    url ? linkNode(partText, url, onOpen) : document.createTextNode(partText),
  );
