# Curated generator palette: the subset of each stage's allowed words that is
# safe and useful for story generation. Cumulative, like the word lists.
# The phonics validator uses the FULL allowed set; the generator draws only
# from the palette. Human nouns and anything frightening are excluded here.

P = {}

P[1] = {
 "nouns": "fan mat map pan pin tin fin pad pit nap tip",
 "verbs": "sat sit dip tap pat fit",
 "adjectives": "sad fat tan",
}
P[2] = {
 "nouns": "bag bed bug bus cat cot cub cup dog fig fog gum mud mug net nut pen "
          "pet pod pot pug pup sun top tub den gas",
 "verbs": "cut got tug nod pop beg dug set met sob",
 "adjectives": "big fun bad",
}
P[3] = {
 "nouns": "box fox hat hen hill hut jam jet jug lab leg lid lip log rag rat rib "
          "rock rug van web wig yak yam bell doll duck hog mill neck pill "
          "sack sock tack wick",
 "verbs": "hid hop hug hum hit ran run rub rip jog wag win yell kick lick lock "
          "pack peck pick quit zip toss fill miss pass tell",
 "adjectives": "red wet sick hot",
}
P[4] = {
 "nouns": "ship shop shed shell fish dish chin chick ring wing moth path "
          "bath song thing",
 "verbs": "shut chop chat hang sing rang wish dash rush hush",
 "adjectives": "thin rich long much such",
}
P[5] = {
 "nouns": "bench branch brick clock crab dress drum flag frog grass hand lunch "
          "milk nest pond sand shelf sled slug snack stick stump trunk twig "
          "bank junk skunk bridge edge fudge patch match",
 "verbs": "stop step swim skip slip snap spin trip trap drop drip grab grin "
          "grip clap click crack crash splash jump land lift rest stand stamp "
          "stomp swing think thank trust wink blink drink catch spend "
          "spell smell sniff",
 "adjectives": "black fast fresh glad grand last left lost next pink quick "
               "soft strong stuck",
}
P[6] = {
 "nouns": "cake cane cape tape grape gate plate wave cave face place space "
          "bike kite slide time line vine mice rice smile pipe bone cone stone "
          "home hole mole pole rope note nose rose smoke stove globe cube tube "
          "flute snake lake game name plane crane mane flame blade spike hive "
          "mile tile pile robe joke mule slope shape skate",
 "verbs": "bake make take wake shake came gave save hide ride drive dive wipe "
          "hope poke woke broke spoke drove chose close race trace made fade "
          "trade vote shine use glide",
 "adjectives": "safe brave nice wide white quite cute huge late same fine ripe "
               "whole",
}
P[7] = {
 "nouns": "arm art barn car card cart farm jar park yard corn cork fork form "
          "fort horn thorn storm bird dirt shirt skirt fur herd fern ladder "
          "hammer letter summer winter corner finger number supper harp chart "
          "port more store shore",
 "verbs": "start march turn curl stir twirl whirl surf snore",
 "adjectives": "dark hard sharp smart far short third faster bigger longer",
}
P[8] = {
 "nouns": "rain trail train snail tail nail mail pail chain day hay clay tray "
          "way bee tree feet sheep sheet street wheel seed week deer jeep "
          "bean leaf meal peach sea seal seat stream team beach dream cream "
          "boat coat goat road soap toad oak foam toast crow snow bowl "
          "bunny candy jelly party penny puppy sky light night pie tie",
 "verbs": "wait paint sail play say stay feed feel keep need peek sleep sweep "
          "greet eat read reach teach speak treat clean float soak roam blow "
          "grow show throw glow cry dry fly try",
 "adjectives": "plain main gray green deep free steep sweet neat real east "
               "high bright tight right happy funny lucky muddy silly sunny "
               "tiny windy hungry empty dizzy fluffy sleepy sticky messy low "
               "slow own",
}
P[9] = {
 "nouns": "moon spoon broom room roof root tooth zoo food pool book brook foot "
          "hood hook wood wool cloud ground house mouse mouth sound south trout "
          "snout crown owl town cow crowd coin oil point soil joy toy "
          "claw hawk jaw law lawn paw straw dawn ear gear year "
          "chair hair pair stair air spear",
 "verbs": "shoot swoop scoop zoom cook look shook stood took count found shout "
          "pound howl growl frown plow boil join spoil enjoy crawl draw yawn "
          "haul pause blew chew drew flew grew threw hear clear",
 "adjectives": "cool smooth good loud proud round brown down moist raw few new "
               "near dear fair",
}
# pie and tie moved up to stage 8 with ie /I/; field and brief moved down to
# stage 10 with ie /E/ (Christine, Aug 2026).
P[10] = {
 "nouns": "apple bubble candle castle handle jungle middle puddle table turtle "
          "bottle kettle pebble sparkle city ice fence pencil circle cage page "
          "orange village knee knot wrist phone photo dolphin backpack bedroom "
          "campfire cupcake doghouse flashlight football hilltop mailbox "
          "moonlight pancake playground rainbow sandbox sunset sunshine "
          "treehouse weekend anthill bathtub birthday blanket blossom butter "
          "button chicken chipmunk garden hamster helmet kitten lantern lizard "
          "magnet mitten muffin napkin pocket pumpkin rabbit ribbon robin "
          "rocket tunnel wagon window basket carrot cabin picnic puppet robot "
          "tiger paper music field",
 "verbs": "giggle wiggle wobble tumble nibble jiggle rattle settle knock knit "
          "know wrap write open dance",
 "adjectives": "little purple simple gentle sudden rapid even super slowly "
               "quickly softly quietly",
}

# Decodable but never usable in a story for this age group.
# The content validator rejects any generated sentence containing these.
CONTENT_BLOCKLIST = """
giant prince witch shark thief crime jail wreck shot shock punch crush burst
burn hurt sting stab scar blur grave gun sin
"""

# Decodable words that name a human. The content validator allows the child's
# own name and nothing else, so these are rejected as characters.
HUMAN_NOUNS = """
man men dad mom kid lad tot boy girl sir baby friend people prince giant
vet king queen clown twin
"""
