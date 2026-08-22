import type { Chapter } from './chapters.ts';

export interface SceneAsset {
  id: string;
  src: string;
  width: number;
  height: number;
  ambience: Chapter['ambience'][];
  focal: { x: number; y: number };
}

/**
 * The complete, standalone artwork that may be used behind a story.
 *
 * Keep this allow-list explicit. In particular, `public/images/scenes` holds
 * legacy crops cut from composite sheets and must never become a source for
 * story backgrounds again.
 */
export const SCENE_MANIFEST: readonly SceneAsset[] = [
  {
    id: 'dinosaurs-01',
    src: '/images/landing/dinosaurs-01.jpg',
    width: 1844,
    height: 853,
    ambience: ['jungle', 'countryside'],
    focal: { x: 0.5, y: 0.5 },
  },
  {
    id: 'dinosaurs-02',
    src: '/images/landing/dinosaurs-02.jpg',
    width: 1844,
    height: 853,
    ambience: ['jungle', 'countryside'],
    focal: { x: 0.5, y: 0.5 },
  },
  {
    id: 'ocean-01',
    src: '/images/landing/ocean-01.jpg',
    width: 1844,
    height: 853,
    ambience: ['ocean'],
    focal: { x: 0.5, y: 0.5 },
  },
  {
    id: 'ocean-02',
    src: '/images/landing/ocean-02.jpg',
    width: 1536,
    height: 1024,
    ambience: ['ocean'],
    focal: { x: 0.5, y: 0.5 },
  },
  {
    id: 'space-01',
    src: '/images/landing/space-01.jpg',
    width: 1846,
    height: 852,
    ambience: ['space'],
    focal: { x: 0.5, y: 0.5 },
  },
  {
    id: 'unicorns-01',
    src: '/images/landing/unicorns-01.jpg',
    width: 1122,
    height: 1402,
    ambience: ['fantasy'],
    focal: { x: 0.5, y: 0.45 },
  },
];
