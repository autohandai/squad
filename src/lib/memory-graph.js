export const MEMORY_KINDS = ['memory', 'lesson', 'decision', 'preference', 'discovery'];
export const MEMORY_COLORS = ['#518cce', '#bb7ace', '#d28c46', '#4a9f88', '#ca7086', '#829a44', '#7082c8', '#ae905c', '#4b9fac'];
const hash = value => [...String(value)].reduce((result, character) => Math.imul(result ^ character.codePointAt(0), 16777619) >>> 0, 2166136261);
export const memoryColor = (id, preferred) => /^#[0-9a-f]{6}$/i.test(preferred || '') ? preferred : MEMORY_COLORS[hash(id) % MEMORY_COLORS.length];
export const scopeLabel = record => record.scope === 'team' ? 'Whole team' : record.scope === 'project' ? 'Project' : 'Private';

/** Stable clusters prevent the canvas jumping when records are refreshed. */
export function layoutMemoryGraph(records, members, groups, grouping = 'agent', colors = {}) {
  const byMember = new Map(members.map(item => [item.id, item]));
  const byGroup = new Map(groups.map(item => [item.id, item]));
  const buckets = new Map();
  for (const record of records) {
    const key = grouping === 'kind' ? record.kind : grouping === 'group' ? record.groupId || '__ungrouped' : record.ownerId || '__team';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(record);
  }
  const ordered = [...buckets].sort(([a], [b]) => a.localeCompare(b));
  const nodes = [], clusters = [], links = [];
  const columns = Math.max(1, Math.ceil(Math.sqrt(ordered.length * 1.45)));
  const rows = Math.ceil(ordered.length / columns);
  const spacing = 290;
  for (let index = 0; index < ordered.length; index++) {
    const [id, entries] = ordered[index];
    const member = byMember.get(id), group = byGroup.get(id);
    const name = grouping === 'kind' ? `${id[0]?.toUpperCase()}${id.slice(1)}` : grouping === 'group' ? group?.name || 'Ungrouped' : member?.name || (id === '__team' ? 'Whole team' : 'Former member');
    const color = memoryColor(id, grouping === 'group' ? group?.color : colors[id] || member?.color);
    const x = (index % columns - (columns - 1) / 2) * spacing;
    const y = (Math.floor(index / columns) - (rows - 1) / 2) * spacing;
    const centerId = `cluster:${id}`;
    const radius = Math.min(130, 56 + Math.sqrt(entries.length) * 7);
    clusters.push({ id: centerId, key: id, name, color, x, y, radius, count: entries.length });
    nodes.push({ id: centerId, x, y, radius: 22, color, title: name, cluster: true, clusterId: centerId });
    const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
    sorted.forEach((record, row) => {
      // A golden-angle spiral keeps large clusters legible without collisions
      // or a permanent force simulation running while the screen is idle.
      const angle = row * 2.399963229728653 + (hash(id) % 360) * Math.PI / 180;
      const distance = 45 + Math.sqrt((row + 1) / sorted.length) * (radius - 38);
      const ownColor = memoryColor(record.ownerId || '__team', colors[record.ownerId] || byMember.get(record.ownerId)?.color);
      nodes.push({ id: record.id, record, x: x + Math.cos(angle) * distance, y: y + Math.sin(angle) * distance, radius: record.pinned ? 8 : 6, color: grouping === 'agent' || grouping === 'network' ? ownColor : color, clusterId: centerId, title: record.title });
      links.push({ id: `owner:${record.id}`, from: centerId, to: record.id, relation: grouping === 'kind' ? 'kind' : grouping === 'group' ? 'group' : 'owner', structure: true });
    });
  }
  return { nodes, clusters, links };
}

export function fitMemoryGraph(nodes, width, height) {
  if (!nodes.length) return { x: width / 2, y: height / 2, scale: 1 };
  const xs = nodes.map(node => node.x), ys = nodes.map(node => node.y);
  const left = Math.min(...xs) - 70, right = Math.max(...xs) + 100;
  const top = Math.min(...ys) - 65, bottom = Math.max(...ys) + 65;
  const scale = Math.min(1.6, Math.max(0.12, Math.min(width / (right - left), height / (bottom - top)) * 0.88));
  return { scale, x: width / 2 - (left + right) / 2 * scale, y: height / 2 - (top + bottom) / 2 * scale };
}
