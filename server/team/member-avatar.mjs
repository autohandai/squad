// A member changes its own avatar (ADR-0243). squad_avatars lists the cast;
// squad_set_avatar comes here. The member can only choose a cast bird by id:
// the stored value is always /avatars/birds/<bird>.webp, never a URL or image
// a model supplied. It is saved on the member's bridge copy with the profile
// revision bumped, and returned as a `profile` receipt, the shape the browser
// already applies (applyProfileReceipts), so the sidebar, chats, channels,
// Quick Chat, the menu bar and the phone follow the same way they follow a
// rename.
import { birdAvatarSrc, birdById } from '../../src/lib/bird-cast.js';

export function createAvatarSetter({ actions }) {
  return async function setAvatar(memberId, bird) {
    const chosen = birdById(bird);
    if (!chosen) throw new Error(`${String(bird || 'That').slice(0, 40)} is not one of Squad's birds. Pick an id from squad_avatars.`);
    const access = await actions().memberAccess(memberId);
    if (!access?.agent || access.removed) throw new Error('This member is no longer available.');
    const avatar = birdAvatarSrc(chosen.id);
    const saved = await actions().setAccess(memberId, { agent: access.agent, profilePatch: { avatar }, avatarActor: 'agent' });
    return { id: `avatar-${memberId}-${saved.profileRevision}`, type: 'profile', status: 'applied', actorId: memberId, bird: chosen.id, patch: { avatar }, profileRevision: saved.profileRevision, message: `${access.agent.name} is now the ${chosen.label}.` };
  };
}
