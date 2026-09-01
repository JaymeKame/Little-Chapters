export interface CanonicalSessionIdentity {
  storyRequestStatus: 'idle' | 'loading' | 'resolved' | 'failed';
  canonicalChapterId: string | null;
  activeChapterId: string | null;
  storyRequestChapterId: string | null;
  visualRequestChapterId: string | null;
  canonicalOwnershipReady: boolean;
}

/** Reading is enabled only after story and visual ownership are bound to one
 * identity. This does not wait for image generation itself to finish. */
export function canonicalReadingStartEnabled(identity: CanonicalSessionIdentity): boolean {
  const id = identity.canonicalChapterId;
  return identity.storyRequestStatus === 'resolved' && identity.canonicalOwnershipReady && Boolean(id)
    && identity.activeChapterId === id
    && identity.storyRequestChapterId === id
    && identity.visualRequestChapterId === id;
}
