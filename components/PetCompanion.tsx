'use client';

/* Momo the reading pet — companion card + usePet() hook.
 *
 * The hook owns pet state (load on mount, persist on change) and exposes
 * awardReading() for the reading flow to call once per scored take. The card
 * renders the pet's growth stage, speech bubble, XP bar, streak, and daily
 * progress. Self-contained on purpose: when the kid-facing redesign happens,
 * this card moves as one piece.                                              */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyReading,
  awardForReading,
  currentStreak,
  defaultPetState,
  greetingFor,
  levelForXp,
  levelProgress,
  loadPetState,
  reactionFor,
  savePetState,
  stageForLevel,
  todayKey,
  type PetMessage,
  type PetState,
  type ReadingOutcome,
} from '@/lib/pet';

export interface PetHandle {
  state: PetState | null;
  message: PetMessage | null;
  /** Non-null briefly after an award — drives the "+XP" float. */
  flash: { xp: number; levelUp: boolean } | null;
  awardReading: (outcome: ReadingOutcome) => void;
}

export function usePet(uid: string | null): PetHandle {
  const [state, setState] = useState<PetState | null>(null);
  const [message, setMessage] = useState<PetMessage | null>(null);
  const [flash, setFlash] = useState<{ xp: number; levelUp: boolean } | null>(null);
  const uidRef = useRef(uid);
  uidRef.current = uid;
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let stale = false;
    // Fresh identity: drop the previous user's state/message so a stale (but
    // newer-stamped) pet can't win the reconcile below on account switch.
    setState(null);
    setMessage(null);
    void loadPetState(uid).then((s) => {
      if (stale) return;
      // An award can land while the load is in flight (kid reads immediately
      // on a slow network) — keep whichever state is newer, never overwrite.
      setState((cur) => (cur && cur.updatedAt >= s.updatedAt ? cur : s));
      // Award reactions outrank the greeting; only greet when nothing spoke.
      setMessage((m) => m ?? greetingFor(s));
    });
    return () => {
      stale = true;
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [uid]);

  const awardReading = useCallback((outcome: ReadingOutcome) => {
    setState((prev) => {
      const base = prev ?? defaultPetState();
      const award = awardForReading(outcome);
      const next = applyReading(base, award, todayKey());
      const leveledUp = levelForXp(next.xp) > levelForXp(base.xp);
      savePetState(uidRef.current, next);
      setMessage(reactionFor(award, outcome.flaggedCount, leveledUp));
      setFlash({ xp: award.xp, levelUp: leveledUp });
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), 2500);
      return next;
    });
  }, []);

  return { state, message, flash, awardReading };
}

const MOOD_ANIMATION: Record<string, string> = {
  happy: 'pet-bob 2.4s ease-in-out infinite',
  excited: 'pet-hop 0.7s ease-in-out 4',
  sleepy: 'pet-bob 3.6s ease-in-out infinite',
  longing: 'pet-bob 3.6s ease-in-out infinite',
};

/* variant 'child': Momo as a pure companion — stage, name, speech bubble, and
 * the XP float only. NO xp bar, level number, streak, or goal dots: the
 * product handoff forbids scores/streaks/XP in child-facing UI (growth shows
 * wordlessly through the stage emoji). variant 'parent' shows the full
 * progress detail — that's "progress you can feel good about", for adults.  */
export function PetCompanion({ pet, variant = 'parent' }: { pet: PetHandle; variant?: 'child' | 'parent' }) {
  const s = pet.state;
  if (!s) return null;
  const level = levelForXp(s.xp);
  const [gained, needed] = levelProgress(s.xp);
  const stage = stageForLevel(level);
  const streak = currentStreak(s);
  // Tab left open past midnight: yesterday's count isn't "today" anymore.
  const readingsToday = s.lastActiveDay === todayKey() ? s.readingsToday : 0;
  const mood = pet.message?.mood ?? 'happy';

  return (
    <section
      aria-label={`${s.name} the reading pet`}
      style={{
        display: 'flex',
        gap: 16,
        alignItems: 'center',
        border: '1px solid #e3d9f3',
        background: 'linear-gradient(135deg, #faf7ff 0%, #f0f7ff 100%)',
        borderRadius: 14,
        padding: '14px 18px',
        marginBottom: 20,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes pet-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
        @keyframes pet-hop { 0%,100% { transform: translateY(0) rotate(0deg); } 30% { transform: translateY(-12px) rotate(-6deg); } 60% { transform: translateY(0) rotate(4deg); } }
        @keyframes pet-xp-float { 0% { opacity: 0; transform: translateY(6px); } 20% { opacity: 1; } 100% { opacity: 0; transform: translateY(-22px); } }
        @media (prefers-reduced-motion: reduce) { .pet-emoji, .pet-xp { animation: none !important; } }
      `}</style>

      <div style={{ position: 'relative', flex: 'none', textAlign: 'center', width: 78 }}>
        <div className="pet-emoji" style={{ fontSize: 52, lineHeight: 1.2, animation: MOOD_ANIMATION[mood] }}>
          {stage.emoji}
        </div>
        <div style={{ fontSize: 11, color: '#7a6f8f', marginTop: 2 }}>
          {variant === 'child' ? s.name : `${s.name} · Lv ${level}`}
        </div>
        {pet.flash && (
          <div
            className="pet-xp"
            style={{
              position: 'absolute',
              top: -4,
              right: -6,
              fontSize: 14,
              fontWeight: 700,
              color: '#7c3aed',
              animation: 'pet-xp-float 2.4s ease-out forwards',
            }}
          >
            +{pet.flash.xp} XP{pet.flash.levelUp ? ' 🎉' : ''}
          </div>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {pet.message && (
          <div
            style={{
              background: '#fff',
              border: '1px solid #e6e0f0',
              borderRadius: '12px 12px 12px 3px',
              padding: '8px 12px',
              fontSize: 14,
              color: '#3d3554',
              marginBottom: 8,
              display: 'inline-block',
            }}
          >
            {pet.message.text}
          </div>
        )}

        {variant === 'parent' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 140px', maxWidth: 240 }}>
            <div style={{ height: 8, background: '#e9e3f5', borderRadius: 999 }}>
              <div
                style={{
                  height: 8,
                  width: `${Math.min(100, Math.round((gained / needed) * 100))}%`,
                  background: 'linear-gradient(90deg, #a78bfa, #7c3aed)',
                  borderRadius: 999,
                  transition: 'width 0.6s ease',
                }}
              />
            </div>
            <div style={{ fontSize: 10.5, color: '#8b81a3', marginTop: 2 }}>
              {gained}/{needed} XP to level {level + 1} · {stage.label}
            </div>
          </div>

          <div title="Days in a row with at least one reading" style={{ fontSize: 13, color: '#b45309', fontWeight: 600 }}>
            🔥 {streak} day{streak === 1 ? '' : 's'}
          </div>

          <div title={`Today's readings (goal: ${s.dailyGoal})`} style={{ fontSize: 13, letterSpacing: 2 }}>
            {Array.from({ length: s.dailyGoal }, (_, i) => (
              <span key={i} style={{ color: i < readingsToday ? '#7c3aed' : '#d8d0e8' }}>
                ●
              </span>
            ))}
          </div>
        </div>
        )}
      </div>
    </section>
  );
}
