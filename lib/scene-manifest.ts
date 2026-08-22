export interface SceneAsset {
  id: string;
  src: string;
  width: number;
  height: number;
  focal: { x: number; y: number };
}

const LANDING_ROOT = '/images/landing';

/** The complete allow-list of presentation-ready story backgrounds. */
export const SCENE_MANIFEST: readonly SceneAsset[] = [
  ['aug21-151658', 'ChatGPT Image Aug 21, 2026 at 03_16_58 PM.png', 1024, 1536],
  ['aug21-151706', 'ChatGPT Image Aug 21, 2026 at 03_17_06 PM.png', 1023, 1537],
  ['aug21-151713', 'ChatGPT Image Aug 21, 2026 at 03_17_13 PM.png', 1023, 1537],
  ['aug21-151720', 'ChatGPT Image Aug 21, 2026 at 03_17_20 PM.png', 1023, 1537],
  ['aug21-151728', 'ChatGPT Image Aug 21, 2026 at 03_17_28 PM.png', 1023, 1537],
  ['aug21-151735', 'ChatGPT Image Aug 21, 2026 at 03_17_35 PM.png', 1536, 1024],
  ['aug21-151740', 'ChatGPT Image Aug 21, 2026 at 03_17_40 PM.png', 1536, 1024],
  ['aug21-151751-1', 'ChatGPT Image Aug 21, 2026 at 03_17_51 PM (1).png', 1536, 1024],
  ['aug21-151752-2', 'ChatGPT Image Aug 21, 2026 at 03_17_52 PM (2).png', 1536, 1024],
  ['aug21-151759', 'ChatGPT Image Aug 21, 2026 at 03_17_59 PM.png', 1536, 1024],
  ['aug21-151806', 'ChatGPT Image Aug 21, 2026 at 03_18_06 PM.png', 1536, 1024],
  ['aug21-151813', 'ChatGPT Image Aug 21, 2026 at 03_18_13 PM.png', 1536, 1024],
  ['aug21-151820', 'ChatGPT Image Aug 21, 2026 at 03_18_20 PM.png', 1536, 1024],
].map(([id, filename, width, height]) => ({
  id: id as string,
  src: `${LANDING_ROOT}/${filename}`,
  width: width as number,
  height: height as number,
  focal: { x: 0.5, y: 0.5 },
}));
