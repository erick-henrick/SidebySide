export function youtubeVideoId(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
  let source;
  try { source = new URL(text); } catch { return null; }
  let id;
  if (source.hostname === 'youtu.be') id = source.pathname.slice(1);
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(source.hostname)) {
    id = source.searchParams.get('v') || source.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1];
  }
  return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null;
}

export async function videoMetadata(videoId) {
  const fallback = { videoId, title: 'Vídeo ' + videoId, channel: '', duration: '' };
  const url = new URL('https://www.youtube.com/oembed');
  url.searchParams.set('url', 'https://www.youtube.com/watch?v=' + videoId);
  url.searchParams.set('format', 'json');
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return fallback;
    const data = await response.json();
    return { ...fallback, title: String(data.title || fallback.title).slice(0, 200),
      channel: String(data.author_name || '').slice(0, 120) };
  } catch {
    return fallback;
  }
}

function textOf(value) {
  return value?.simpleText || value?.runs?.map(run => run.text).join('') || '';
}

export async function searchVideos(query) {
  const directId = /^https?:\/\//i.test(String(query || '')) ? youtubeVideoId(query) : null;
  if (directId) return [await videoMetadata(directId)];
  const text = String(query || '').trim();
  if (text.length < 2 || text.length > 100) throw new Error('Digite de 2 a 100 caracteres para buscar.');
  const url = new URL('https://www.youtube.com/results');
  url.searchParams.set('search_query', text);
  url.searchParams.set('hl', 'pt-BR');
  url.searchParams.set('gl', 'BR');
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('A pesquisa do YouTube está indisponível.');
  const html = await response.text();
  const assignment = 'var ytInitialData = ';
  const start = html.indexOf(assignment);
  const end = html.indexOf('</script>', start);
  if (start < 0 || end < 0) throw new Error('A pesquisa do YouTube está indisponível.');
  const json = html.slice(start + assignment.length, end).trim().replace(/;$/, '');
  let data;
  try { data = JSON.parse(json); } catch { throw new Error('Não foi possível ler a pesquisa do YouTube.'); }
  const sections = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
  const renderers = sections.flatMap(section => section.itemSectionRenderer?.contents || []);
  const videos = renderers.filter(item => item.videoRenderer).map(({ videoRenderer: video }) => ({
    videoId: video.videoId,
    title: textOf(video.title).slice(0, 200),
    channel: textOf(video.ownerText || video.longBylineText).slice(0, 120),
    duration: textOf(video.lengthText),
  }));
  return videos.filter(video => youtubeVideoId(video.videoId)).slice(0, 20);
}
