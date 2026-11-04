const ID = /^artifact_[a-f0-9-]{36}$/;
export function artifactIdFromHref(href) {
  if (!String(href).startsWith('/')) return '';
  try {
    const url = new URL(href, 'http://squad.local');
    const id = url.searchParams.get('artifact');
    return /^\/squad-members\/[^/]+\/library$/.test(url.pathname) && ID.test(id || '') ? id : '';
  } catch { return ''; }
}
export function openArtifact(id) {
  if (ID.test(id || '')) window.dispatchEvent(new CustomEvent('squad:open-artifact', { detail: { id } }));
}
export const artifactDate = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : '';
export const artifactSize = size => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${Math.round(size / 1024)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
