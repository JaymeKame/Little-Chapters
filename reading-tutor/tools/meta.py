# Per-stage editorial metadata and source alignment.

M = {
1: dict(
  label="Short a and short i, first nine letters",
  focus="Blending and segmenting VC and CVC words with two vowels and seven consonants.",
  ufli="Group 1: a, m, s, f, i, p, t, n, d, nasalized a, CVC patterns",
  las="Phase 2, Sets 1-2 (s a t p, i n m d). This stage is a superset of the "
      "'satpin' starter set: it adds f and d so that stage 1 yields enough "
      "words to build sentences.",
  note="Deliberately the narrowest stage. Expect most children to clear it in "
       "under a week. 'is' and 'and' are taught as heart words here because "
       "s-as-/z/ and final blends are not introduced until stages 3 and 5."),
2: dict(
  label="All five short vowels",
  focus="Short o, u and e complete the short-vowel set; c, k, b and hard g "
        "complete the common single-consonant stops.",
  ufli="Group 2: c (cat), o, k, u, b, g (go), e",
  dev="UFLI Group 2 also contains sh and the CCVC/CVCC patterns. We hold sh "
      "until stage 4, with the other digraphs, and all consonant blends until "
      "stage 5. This keeps stages 1-4 structurally identical - one consonant "
      "sound either side of the vowel - so the only thing changing across "
      "those four stages is the sound inventory. Letters and Sounds Phase 4 "
      "supports treating blends as their own step, since they introduce no "
      "new letter-sound correspondences. Verified against UFLI Aug 2026: "
      "stage 1 letters match Group 1 exactly; stage 2 matches Group 2 except "
      "for the two deferrals named here.",
  las="Phase 2, Sets 3-4 (g o c k, ck e u r)",
  note="This is the stage where the vocabulary becomes large enough for real "
       "sentences. Cumulative allowed set passes 150 words here."),
3: dict(
  label="Remaining single consonants, floss rule, and ck",
  focus="h, v, r, l, j, z, w, y, x and qu; s saying /z/ in is, has, his; the "
        "floss rule (ff, ll, ss, zz); ck after a short vowel. Plural and "
        "third-person -s is available from this stage.",
  ufli="Group 3: h, v, r, l, j, z, w/wh, y (consonant), s /z/ (is), ck, ff, ll, ss, zz",
  las="Phase 2, Set 5 and Phase 3 single letters (j v w x y z zz qu)",
  note="Adding -s here is what makes present-tense narration possible."),
4: dict(
  label="Consonant digraphs",
  focus="sh, ch, th (voiced and unvoiced), wh and ng. Still one consonant "
        "sound either side of the vowel, so digraph words are structurally "
        "no harder than stage 3 CVC words.",
  ufli="Group 3 (th, ch, sh, wh) and Group 8 (ng)",
  dev="sh arrives here rather than in UFLI Group 2, so that all five "
      "consonant digraphs are taught together.",
  las="Phase 3 consonant digraphs (ch sh th ng)",
  note="Unlocks this, that, them, then, with, which - the connective tissue "
       "of narrative prose."),
5: dict(
  label="Consonant blends",
  focus="Initial and final blends up to three consonants (stop, hand, "
        "splash, strong), plus -tch and -dge after a short vowel. Suffix "
        "-ing becomes available.",
  ufli="Group 2 (CCVC and CVCC patterns) extended with Group 6 -tch/-dge",
  dev="CCVC and CVCC arrive here rather than in UFLI Group 2. Christine "
      "flagged Aug 2026 that 142 new words in one stage is large and that "
      "standard practice splits blends into r-, l-, s- and final blends. "
      "Deferred to v2: splitting this stage changes every stage number above "
      "it and touches progression logic.",
  las="Phase 4 - no new letter-sound correspondences, only adjacent consonants",
  note="The single biggest jump in usable vocabulary. Verbs of motion arrive "
       "here, which is when cliffhangers start to work."),
6: dict(
  label="Silent e and long vowels",
  focus="a_e, i_e, o_e, u_e and e_e split digraphs. Suffix -ed becomes "
        "available, so past-tense narration is possible for the first time.",
  ufli="Group 3: silent e, CVCe patterns",
  las="Phase 5 split digraphs (a_e e_e i_e o_e u_e)",
  note="Contrast pairs (cap/cape, hop/hope) are worth surfacing in the story "
       "deliberately - they are the point of this stage."),
7: dict(
  label="R-controlled vowels and two-syllable words",
  focus="ar, or, ore, er, ir and ur. Words may now be two syllables, which "
        "brings in the very common -er ending (bigger, winter, ladder).",
  ufli="Group 4 (ar, or, er) and Group 5 (ir, ur, closed and open syllables, "
       "multisyllable words)",
  las="Phase 3 (ar or ur er) and Phase 5",
  note="Two syllables is a real cognitive step. Hold sentence length steady "
       "for a session or two after a child arrives here."),
8: dict(
  label="Long vowel teams",
  focus="ai, ay, ee, ea, oa, ow (as in snow), igh, and y saying /E/ (happy) "
        "or /I/ (cry). Suffixes -er and -est become available.",
  ufli="Group 4 (ai, ay, ee, ea) and Group 5 (oa, ow, y as a vowel)",
  las="Phase 3 (ai ee igh oa) and Phase 5 (ay ea)",
  note="Largest single vocabulary addition in the sequence. Adjectives finally "
       "become plentiful, which is what makes descriptions land."),
9: dict(
  label="Diphthongs and other vowel teams",
  focus="oo (both sounds), ou, ow (as in cow), oi, oy, aw, au, ew, ie, ear "
        "and air.",
  ufli="Group 6 (ou, ow, oi, oy, oo, ie) and Group 8 (ew, au, aw)",
  las="Phase 3 (oo ow oi ear air) and Phase 5 (ou ie oy aw ew)",
  note="Note that ow and oo each have two sounds. The audio engine should "
       "expect either pronunciation on first attempt."),
10: dict(
  label="Multisyllable words, soft c and g, silent letters",
  focus="Open syllables (robot, paper), the final stable syllable -le "
        "(apple, turtle), soft c and g (city, gem), kn, wr and ph, compound "
        "words, and up to three syllables.",
  ufli="Group 5 (open syllables), Group 7 (c and g before i/e/y), Group 11 "
       "(wr, kn, ph)",
  las="Phase 5 and beyond",
  note="End of the intended range. A child reading fluently at stage 10 is "
       "decoding at roughly end-of-first-grade level and has outgrown this "
       "product's ceiling."),
}

SOURCES = [
 dict(id="ufli-scope",
      title="Suggested Scope & Sequence for Teaching Phoneme-Grapheme Correspondences",
      publisher="University of Florida Literacy Institute (UFLI)",
      url="https://ufli.education.ufl.edu/wp-content/uploads/2022/01/UFLI-Scope-and-Sequence-5-21-1.pdf",
      mirror="https://www.readingrockets.org/sites/default/files/2023-10/UFLI-Scope-Sequence-phonics.pdf",
      used_for="Primary ordering of phoneme-grapheme correspondences. Groups 1-11 "
               "map onto stages 1-10 as recorded in each stage's ufli_alignment field."),
 dict(id="ufli-overview",
      title="UFLI Foundations Overview",
      publisher="University of Florida Literacy Institute",
      url="https://ufli.education.ufl.edu/wp-content/uploads/2022/06/UFLI-Foundations-Overview-5pg.pdf",
      used_for="Programme rationale and the simple-view-of-reading framing behind "
               "separating decoding accuracy from comprehension."),
 dict(id="letters-and-sounds",
      title="Letters and Sounds: Principles and Practice of High Quality Phonics "
            "(phase structure)",
      publisher="UK Department for Education, via letters-and-sounds.com and "
                "PhonicsPlay subject knowledge notes",
      url="https://letters-and-sounds.com/phase-2-resources/",
      used_for="Cross-check on stage boundaries and on the order of consonant "
               "digraphs and vowel digraphs. Phase 4 confirms that consonant "
               "blends introduce no new correspondences, which is why stage 5 "
               "adds structure rather than graphemes."),
 dict(id="dolch",
      title="Complete Dolch Word List Divided by Level",
      publisher="E. W. Dolch, reproduced by CEESA",
      url="https://www.ceesa.org/wp-content/uploads/2021/02/4.15.6-Dolch-completerList-aa.pdf",
      used_for="Every sight word in this file is drawn from the Dolch pre-primer, "
               "primer, grade 1, grade 2 or grade 3 list. The specific list is "
               "recorded per word in sight_word_provenance."),
 dict(id="fry",
      title="Fry 1000 Instant Words",
      publisher="Edward Fry, reproduced by sightwords.com",
      url="https://sightwords.com/pdfs/word_lists/fry_1st_100.pdf",
      used_for="Secondary source for a small number of high-frequency words that "
               "are not on any Dolch list (of, other, another, should, water, "
               "half, enough, friend, thought, through, different, sure, special, "
               "usually, favorite, beautiful)."),
 dict(id="rrq-efficacy",
      title="Effect of an Instructional Program in Foundational Reading Skills on "
            "Early Literacy Development of Students in Kindergarten and First Grade",
      publisher="Lane et al., Reading Research Quarterly (2025)",
      url="https://ila.onlinelibrary.wiley.com/doi/10.1002/rrq.607",
      used_for="Efficacy evidence for the UFLI sequence in K and grade 1, the "
               "age band this product targets."),
]
