import { ownerSchema } from '@autohand/squad-portable';
import { ownerKey } from './identity.mjs';

/** Ordinary edits cannot transfer a member; restore is a separate operation. */
export function stampOwnedProfile(profile, selectedOwner) {
  const owner = ownerSchema.parse(selectedOwner);
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw Error('Provide a member profile.');
  for (const value of [profile.owner, profile.ownership].filter(value => value !== undefined)) {
    const parsed = ownerSchema.safeParse(value);
    if (!parsed.success || ownerKey(parsed.data) !== ownerKey(owner)) throw Object.assign(Error('This member belongs to another Squad. Use an explicit backup restore into the selected owner.'), { status: 409, code: 'ownership_immutable' });
  }
  if (profile.ownerId !== undefined && profile.ownerId !== owner.id) throw Object.assign(Error('Profile edits cannot transfer ownership.'), { status: 409, code: 'ownership_immutable' });
  const { owner: _source, ownerId: _ownerId, ownership: _oldOwner, ...content } = profile;
  return { ...content, ownership: owner };
}
