/**
 * Story skeletons. Beats fixed, nouns variable.
 *
 * Each beat is a template with blanks: {child}, {pet}, {creature}, {object},
 * {place}. The CODE fills those blanks from the stage palette before the model
 * is called, so every noun in a chapter is guaranteed legal by construction.
 * The model's only job is phrasing - turning a filled beat into a natural
 * sentence of the right length using palette words.
 *
 * The design problem: real suspense for a five-year-old using around fifty
 * words at stage 1. There is no room for plot at that vocabulary. What works
 * instead is INTERRUPTION - something is happening, and we stop.
 *
 * Three engines, all cheap in words:
 *   unopened   - a container, a door, a lid. We stop before it opens.
 *   unseen     - a sound, a movement, a shape. We stop before we look.
 *   unfinished - reaching, climbing, following. We stop mid-motion.
 *
 * Every skeleton ends on a verb or a noun, never on a resolution.
 */

import { canRunAtStage, slotsUsed, type SlotType } from './slots';

export interface Skeleton {
  id: string;
  name: string;
  engine: 'unopened' | 'unseen' | 'unfinished';
  /** Templates, one per sentence. Length sets the chapter length. */
  beats: string[];
  /** Passed to the model verbatim as the ending instruction. */
  cliffhangerNote: string;
}

export const SKELETONS: Skeleton[] = [
  {
    id: 'the-thing-that-was-not-there-before',
    name: 'The thing that was not there before',
    engine: 'unopened',
    beats: [
      '{child} and {pet} are doing something ordinary.',
      '{child} sees a {portable}.',
      'The {portable} was not there before.',
      '{pet} gets to the {portable} first.',
      '{child} reaches for the {portable}.',
      'The {portable} changes as {child} touches it.',
    ],
    cliffhangerNote:
      'End on the moment of contact, before anything opens or is revealed. ' +
      'The last sentence is the change itself, not what caused it.',
  },
  {
    id: 'the-sound-from-somewhere',
    name: 'The sound from somewhere',
    engine: 'unseen',
    beats: [
      '{child} and {pet} are settling down somewhere quiet.',
      'A sound comes from a {object}. Do not say what makes it.',
      'They both stop and listen.',
      'The sound comes again, louder.',
      '{child} goes to the {object}.',
      'Something inside the {object} moves.',
    ],
    cliffhangerNote:
      'The child must never see the source. End with them reaching the ' +
      'object the sound comes from, and stop.',
  },
  {
    id: 'the-one-that-follows',
    name: 'The one that follows',
    engine: 'unfinished',
    beats: [
      '{child} and {pet} set off on an ordinary errand.',
      'A {creature} watches them.',
      'They go on, and the {creature} comes too.',
      '{child} stops, and the {creature} stops.',
      'The {creature} does something an animal should not do.',
    ],
    cliffhangerNote:
      'The strange thing the animal does IS the ending. Do not have the child ' +
      'respond to it, explain it, or feel anything about it. The act, then stop.',
  },
  {
    id: 'the-way-in',
    name: 'The way in',
    engine: 'unopened',
    beats: [
      '{child} and {pet} are at the {place}.',
      '{pet} finds a gap they have never seen.',
      '{child} looks in. Give one detail only.',
      '{pet} goes in.',
      '{child} calls {pet}. Nothing comes back.',
      '{child} goes in after {pet}.',
      '{child} sees one thing inside.',
    ],
    cliffhangerNote:
      'End inside, on one sensory detail, before any of it makes sense. ' +
      'Never resolve where the pet went.',
  },
  {
    id: 'the-thing-that-will-not-stay-put',
    name: 'The thing that will not stay put',
    engine: 'unfinished',
    beats: [
      '{child} puts a {portable} somewhere safe at the {place}.',
      '{child} and {pet} go and do something else.',
      'The {portable} is not where {child} left it.',
      '{child} finds the {portable} somewhere it could not have got to.',
      '{child} puts the {portable} back and watches it.',
      'The {portable} moves.',
    ],
    cliffhangerNote:
      'The last sentence is the object moving while the child watches. ' +
      'No reaction, no explanation, no next action.',
  },
  {
    id: 'the-one-who-is-waiting',
    name: 'The one who is waiting',
    engine: 'unseen',
    beats: [
      '{child} and {pet} go to the {place} as they often do.',
      'Today a {creature} is already there, waiting.',
      'Describe only how still it is.',
      'It does not move as they get closer.',
      '{pet} goes to the {creature} without any fear.',
      '{child} sees that {pet} knows the {creature}.',
    ],
    cliffhangerNote:
      'The reveal is that the PET recognises the animal and the child does not. ' +
      'End on the child understanding that, and nothing more.',
  },
  {
    id: 'the-thing-that-was-left-for-them',
    name: 'The thing that was left for them',
    engine: 'unopened',
    beats: [
      '{child} finds a {portable} left where it would be found.',
      'It is shut, or covered.',
      'There is one mark on it that means something to {child}.',
      '{child} and {pet} take it to the {place}.',
      '{child} gets it open just enough to see one thing inside.',
      'That one thing is not what {child} expected.',
    ],
    cliffhangerNote:
      'Exactly one glimpse. End on that glimpse and never open it fully. ' +
      'Do not say who left it - there are no other people in this world, so ' +
      'the question of who must stay open.',
  },
  {
    id: 'the-path-that-changed',
    name: 'The path that changed',
    engine: 'unfinished',
    beats: [
      '{child} and {pet} walk to the {place} the way they always do.',
      'Today one thing along the way is different.',
      'They stop and look at the {object}.',
      'Going on means passing it.',
      '{pet} goes first, then waits.',
      '{child} follows and looks back.',
      'The {object} is no longer behind them.',
    ],
    cliffhangerNote:
      'End on the absence. The thing is simply not there any more. ' +
      'No reaction, no explanation, no fear - the fact, and stop.',
  },
];

/** Skeletons whose slots can all be filled from this stage's vocabulary. */
export function skeletonsForStage(stage: number): Skeleton[] {
  return SKELETONS.filter((s) => canRunAtStage(s.beats, stage));
}

export function slotsFor(skeleton: Skeleton): SlotType[] {
  return slotsUsed(skeleton.beats);
}

/**
 * Picks a skeleton the child has not had recently.
 *
 * Rotation matters more than variety. A five-year-old will not notice two
 * chapters sharing a shape three weeks apart. They will notice it two nights
 * running.
 */
export function pickSkeleton(
  stage: number,
  recentSkeletonIds: string[],
  random: () => number = Math.random,
): Skeleton {
  const available = skeletonsForStage(stage);
  if (!available.length) {
    throw new Error(`No skeleton can run at stage ${stage}`);
  }
  const unused = available.filter((s) => !recentSkeletonIds.includes(s.id));
  const pool = unused.length ? unused : available;
  return pool[Math.floor(random() * pool.length)];
}
