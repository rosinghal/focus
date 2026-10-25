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

const titleNodes = (text) =>
  titleParts(text).map(({ text: partText, url }) =>
    url
      ? Object.assign(document.createElement('span'), { className: 'title-link', textContent: partText, title: url })
      : document.createTextNode(partText),
  );
