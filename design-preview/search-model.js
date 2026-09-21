'use strict';

// Local fixture search only. The device will eventually ask Astra for results.
function normalizeSearch(value) {
  return String(value).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
}
function findPreviewTracks(catalog,query) {
  const needle=normalizeSearch(query);
  if (!needle) return [];
  const tokens=needle.split(' ');
  return catalog.map((track,index) => {
    const title=normalizeSearch(track.title),artist=normalizeSearch(track.artist);
    const matches=tokens.every(token => `${title} ${artist}`.includes(token));
    const rank=title===needle ? 0 : title.startsWith(needle) ? 1 : title.includes(needle) ? 2 : artist===needle ? 3 : 4;
    return {index,matches,rank};
  }).filter(item => item.matches).sort((a,b) => a.rank-b.rank || a.index-b.index).map(item => item.index);
}

if (typeof module !== 'undefined') module.exports={findPreviewTracks};
