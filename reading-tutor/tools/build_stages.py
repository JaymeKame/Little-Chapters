#!/usr/bin/env python3
"""
Builds and validates stages.json for the reading tutor.

Word lists are authored here as Python data; the script proves every decodable
word is actually decodable with only that stage's cumulative graphemes and
structure rules, then emits the JSON. If a word fails, the build fails.
"""
import json, sys
from collections import OrderedDict

# ---------------------------------------------------------------------------
# Grapheme inventory introduced per stage.
# (grapheme, phoneme_label, example, is_vowel)
# ---------------------------------------------------------------------------

G = {
1: [("a","/a/ as in cat","cat",True),("i","/i/ as in sit","sit",True),
    ("m","/m/","mat",False),("s","/s/","sat",False),("f","/f/","fan",False),
    ("p","/p/","pat",False),("t","/t/","tin",False),("n","/n/","nap",False),
    ("d","/d/","did",False)],

2: [("o","/o/ as in hot","hot",True),("u","/u/ as in cup","cup",True),
    ("e","/e/ as in bed","bed",True),
    ("c","/k/ before a, o, u","cat",False),("k","/k/","kid",False),
    ("b","/b/","bug",False),("g","/g/ hard","got",False)],

3: [("h","/h/","hat",False),("v","/v/","van",False),("r","/r/","run",False),
    ("l","/l/","leg",False),("j","/j/","jam",False),("z","/z/","zip",False),
    ("w","/w/","win",False),("y","/y/ consonant","yes",False),
    ("x","/ks/","box",False),("qu","/kw/","quit",False),
    ("ck","/k/ after a short vowel","duck",False),
    ("ff","/f/ floss rule","puff",False),("ll","/l/ floss rule","bell",False),
    ("ss","/s/ floss rule","miss",False),("zz","/z/ floss rule","buzz",False)],

4: [("sh","/sh/","ship",False),("ch","/ch/","chip",False),
    ("th","/th/ unvoiced and voiced","thin, that",False),
    ("wh","/wh/","when",False),("ng","/ng/","ring",False)],

5: [("tch","/ch/ after a short vowel","catch",False),
    ("dge","/j/ after a short vowel","badge",False)],

6: [("a_e","/A/ long a","cake",True),("i_e","/I/ long i","bike",True),
    ("o_e","/O/ long o","bone",True),("u_e","/U/ long u","cube",True),
    ("e_e","/E/ long e","these",True)],

7: [("ar","/ar/","car",True),("or","/or/","fork",True),("ore","/or/","more",True),
    ("er","/er/","her",True),("ir","/er/","bird",True),("ur","/er/","turn",True)],

8: [("ai","/A/","rain",True),("ay","/A/","play",True),("ee","/E/","tree",True),
    ("ea","/E/","eat",True),("oa","/O/","boat",True),("ow_o","/O/","snow",True),
    ("y_e","/E/ at end of a longer word","happy",True),
    ("y_i","/I/ at end of a short word","cry",True),
    ("igh","/I/","night",True),
    ("ie_i","/I/","pie",True)],

9: [("oo_long","/oo/ as in moon","moon",True),("oo_short","/oo/ as in book","book",True),
    ("ou","/ow/","cloud",True),("ow_ow","/ow/","cow",True),
    ("oi","/oy/","coin",True),("oy","/oy/","toy",True),
    ("aw","/aw/","paw",True),("au","/aw/","haul",True),
    ("ew","/oo/","new",True),
    ("ear","/eer/","hear",True),("air","/air/","chair",True)],

10:[("ie_e","/E/ second sound of ie","chief",True),
    ("le","final stable syllable","apple",False),
    ("c_soft","/s/ before i, e, y","city",False),
    ("g_soft","/j/ before i, e, y","gem",False),
    ("kn","/n/ silent k","knee",False),("wr","/r/ silent w","write",False),
    ("ph","/f/","phone",False),
    ("schwa","unstressed vowel","about",True)],
}

# Graphemes the segmenter actually matches on, per stage (spelling forms).
SEG = {
1: list("amsfiptnd"),
2: list("oucekbg"),
3: ["qu","ck","ff","ll","ss","zz"] + list("hvrljzwyx"),
4: ["sh","ch","th","wh","ng"],
5: ["tch","dge"],
6: [],                      # split digraphs handled structurally
7: ["ar","or","er","ir","ur"],
8: ["ai","ay","ee","ea","oa","ow","igh","y","ie"],
9: ["oo","ou","ow","oi","oy","aw","au","ew","ear","air"],
10:["le","kn","wr","ph","ce","ge"],
}

VOWEL_LETTERS = set("aeiou")
VOWEL_GRAPHEMES = {
 "a","e","i","o","u","y",
 "ar","or","er","ir","ur","ore",
 "ai","ay","ee","ea","oa","ow","igh",
 "oo","ou","oi","oy","aw","au","ew","ie","ear","air",
}

SUFFIXES = {1:[],2:[],3:["s"],4:["s"],5:["s","ing"],6:["s","ing","ed"],
            7:["s","ing","ed"],8:["s","ing","ed","er","est"],
            9:["s","ing","ed","er","est","y"],
            10:["s","es","ing","ed","er","est","y","ly"]}

# Max consecutive consonant graphemes allowed anywhere in the word.
MAX_CLUSTER = {1:1,2:1,3:1,4:1,5:3,6:3,7:3,8:3,9:3,10:3}
MAX_SYLLABLES = {1:1,2:1,3:1,4:1,5:1,6:1,7:2,8:2,9:2,10:3}

SENTENCE_LEN = {1:(5,6),2:(5,6),3:(5,7),4:(5,7),5:(5,8),
                6:(5,8),7:(5,9),8:(5,9),9:(5,9),10:(5,9)}
