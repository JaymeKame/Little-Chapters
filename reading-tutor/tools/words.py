# Decodable words introduced at each stage (new at that stage only).
# Cumulative allowed set for stage N = union of stages 1..N.

W = {}

W[1] = """am an as at if in it
dad dam did dim din dip
fad fan fat fin fit
mad man map mat mid
nap nip
pad pan pat pin pip pit
sad sap sat sip sit
tad tan tap tin tip"""

W[2] = """on up us
bad bag ban bat bed beg bet bib bid big bin bit bob bog bud bug bun bus but
cab cad can cap cat cob cod cog cop cot cub cud cup cut
den dot dog dug
fed fig fog fun
gab gag gap gas gig gob got gum
kid kit
men met mob mom mop mud mug
net nod not nut
peg pen pep pet pod pop pot pug pun pup
sob sod set sub sum sun
ten tot top tub tug
dud gut nub"""

W[3] = """had ham has hat hen hid him hip his hit hog hop hot hub hug hum hut
van vat vet
rag ram ran rap rat red rib rid rig rim rip rob rod rot rub rug run rut
lab lad lap led leg let lid lip lit lob log lot lug
jab jam jet jib job jog jot jug jut
zap zip zig
wag web wed wet wig win wit
yak yam yap yes yet yum
box fax fix fox mix six wax tax ox
quit quiz quip
bell bill doll fell fill fizz fuss hill huff jazz kiss less mess mill miss moss
off pass pill puff sell tell till toss well will yell cuff hiss buzz fuzz
back buck deck dock duck kick lick lock luck neck pack peck pick rack rock
sack sick sock tack tick tuck wick quack"""

W[4] = """ship shop shut shell shed shin shot shock shack
fish dish wish cash dash rush hush mash rash gush
chin chip chop chat chum chick chess much such rich
thin this that them then thud with moth bath path math
when whiz whip which
bang hang king long ring sing song wing lung rang sang sung hung gong ping thing
shell shot"""

W[5] = """and stop spot step swim skip slip snap spin
trip trap drop drip drum grab grin grip crab crib frog from
flag flat flip plan plop plum glad glum
black block blob brick bring clap click clock cluck crack crash cross crush
dress drink dust fast fist flash flush fresh frost grand grass
hand help jump land last left lift list lost lump milk must
nest next pond print quick rest rust sand sent shelf shift silk
sink skin skunk sled slug smell snack sniff soft spell spend splash
stamp stand stick sting stomp strap string strong stuck stump
swept swing test thank think trick trust twig twin went wind wink
bank blink drank junk pink sank tank trunk chunk crunch lunch bench branch
munch punch ranch
catch match patch pitch ditch hutch witch snatch stretch
badge bridge edge fudge judge nudge"""

W[6] = """bake cake lake make take wake snake shake brake flake stake
came game name same flame frame blame
cane lane plane crane mane
cape tape shape grape scrape
date gate late plate skate
safe wave cave gave save brave grave
race face place space trace brace
made fade shade grade blade trade
bike hike like spike strike
bite kite white quite
ride side wide slide hide glide bride pride
time lime dime slime crime prime
line nine pine shine spine vine
five dive hive drive
mice nice rice price slice twice
smile mile while pile tile
fine mine dine spine
wipe ripe pipe stripe
life wife
bone cone stone
home dome
hole mole pole stole whole
hope rope slope
note vote
nose rose close those chose
joke poke smoke woke broke spoke
stove drove
code robe globe
cube cute huge mule tube rule flute use
these theme"""

W[7] = """arm art bar barn car card cart dark far farm hard harm jar
mark park part scar shark sharp smart start tar yard spark chart charm harp
star large_x march starch
born corn cord cork ford fork form fort horn north port short sort sport
storm torn thorn or for
more store shore score chore snore before
her herd fern term perch clerk
after over under never letter better dinner hammer ladder summer winter
faster bigger longer number finger corner supper hunter
bird dirt first shirt sir skirt stir third thirst twirl whirl birth
burn burst curl curb fur hurt purr surf blur spur turn church_x"""

W[8] = """aim bait brain chain fail faint jail laid mail main nail paid pail pain
paint plain rail rain raid sail snail tail trail train wait
away bay clay day gray hay lay may pay play pray ray say spray stay stray
sway today tray way
bee beef beep deep feed feel feet free green greet heel jeep keep need
peek peel queen screen see seed seem seen sheep sheet sleep sleet speed
steep street sweep sweet teeth three tree week weed wheel deer cheer
bead beak beam bean beat clean cream dream each eat east heap heat leaf
leap meal mean meat neat peach peak read real sea seal seat speak steam
stream teach team tea treat wheat beach reach
boat coach coal coast coat croak float foam goal goat load loaf loan moan
oak oat road roam roast soak soap throat toad toast
blow bowl crow flow glow grow low mow own row show slow snow throw tow
baby bunny candy funny happy jelly lucky muddy party penny puppy silly
sunny tiny windy hungry angry empty dizzy fluffy sleepy sticky messy
by cry dry fly fry my shy sky spy try why
bright fight flight high light might night right sigh sight tight fright
die lie pie tie"""

W[9] = """boot broom cool food fool hoop loop moon mood noon pool root roof room
scoop shoot smooth soon spoon stool swoop too tooth zoo zoom groom bloom
book brook cook foot good hood hook look nook shook stood took wood wool
cloud count found ground hound house loud mouse mouth out pound proud round
scout shout snout sound south sprout spout trout
brown clown cow crowd crown down frown growl how howl now owl plow town wow
boil coil coin foil join joint moist oil point soil spoil
boy joy toy enjoy
claw crawl dawn draw fawn hawk jaw law lawn paw raw saw straw yawn shawl
haul launch pause because
blew chew crew dew drew few flew grew new screw stew threw
clear dear ear fear gear hear near tear year spear
air chair fair hair pair stair"""

W[10] = """apple bubble candle castle giggle handle jungle little middle puddle
purple simple table tumble turtle wiggle wobble gentle bottle cattle rattle
saddle settle kettle pebble nibble jiggle sparkle twinkle uncle_x ankle
city ice dance fence prince circle pencil
gem giant magic cage page orange village
knee knew knife knit knock knot know
wrap wreck wrist write wrong
phone photo dolphin graph
backpack bedroom campfire cupcake daytime doghouse flashlight football
hilltop inside mailbox moonlight outside pancake playground rainbow sandbox
sunset sunshine treehouse upstairs weekend anthill bathtub birthday blanket
blossom butter button chicken chipmunk dragon garden hamster helmet kitten
lantern lizard magnet mitten muffin napkin pocket pumpkin rabbit
ribbon robin rocket seven sudden tennis tunnel velvet wagon window
zigzag basket carrot cabin picnic puppet rapid robot tiger paper
open even music super hotel item alone
chief field brief
slowly quickly softly quietly"""

# ---------------------------------------------------------------------------
# Sight / heart words introduced per stage. These bypass the phonics decoder.
# Provenance recorded in PROV.
# ---------------------------------------------------------------------------

S = {}
S[1]  = "a and I is the to my me we said see on"
S[2]  = "are be come do for go here look no so was you"
S[3]  = "he she they have of from what want this that with there"
S[4]  = "all one two three like little into out now down"
S[5]  = "new who how why put pull full very"
S[6]  = "some does were their four again could would"
S[7]  = "should other another oh many any know your"
S[8]  = "every people water where about been once only"
S[9]  = "eight enough friend together thought through half both"
S[10] = "beautiful different sure special usually laugh favorite"

# Sight words whose SPELLING happens to segment with already-taught graphemes
# but whose PRONUNCIATION is irregular at that stage. Documents why each is
# taught as a heart word and suppresses false "already decodable" warnings.
SPELLING_ONLY = {
 "is":"final s says /z/, not taught until stage 3",
 "as":"final s says /z/",
 "all":"the 'al' vowel is not the short a taught in stage 1",
 "put":"u says /oo/ as in book, not short u",
 "pull":"u says /oo/ as in book",
 "full":"u says /oo/ as in book",
 "was":"a says /o/ and s says /z/",
 "on":"regular from stage 2; taught by sight at stage 1 because it is needed sooner",
 "of":"f says /v/",
 "one":"irregular throughout",
 "some":"o says /u/; final e is not a long-vowel marker",
 "does":"o says /u/",
 "half":"l is silent",
 "both":"o is long inside a closed syllable",
 "only":"o is long inside a closed syllable",
 "once":"o says /w-u/",
}

PROV = {
 # word: (source list, becomes decodable at stage or None)
 "a":("Dolch pre-primer",None),"and":("Dolch pre-primer",5),
 "I":("Dolch pre-primer",None),"was":("Dolch primer",None),
 "how":("Dolch grade 1",9),"why":("Dolch grade 2",8),
 "put":("Dolch grade 1",None),"pull":("Dolch grade 2",None),
 "full":("Dolch grade 2",None),"half":("Fry first 300",None),
 "both":("Dolch grade 2",None),"favorite":("Fry first 500",None),
 "is":("Dolch pre-primer",3),"the":("Dolch pre-primer",None),"to":("Dolch pre-primer",None),
 "my":("Dolch pre-primer",8),"me":("Dolch pre-primer",10),"we":("Dolch pre-primer",10),
 "said":("Dolch pre-primer",None),"see":("Dolch pre-primer",8),"on":("Dolch primer",2),
 "are":("Dolch primer",None),"be":("Dolch primer",10),"come":("Dolch primer",None),
 "do":("Dolch primer",None),"for":("Dolch primer",7),"go":("Dolch pre-primer",10),
 "here":("Dolch pre-primer",None),"look":("Dolch pre-primer",9),"no":("Dolch primer",10),
 "so":("Dolch primer",10),"you":("Dolch pre-primer",None),
 "he":("Dolch primer",10),"she":("Dolch primer",None),"they":("Dolch primer",None),
 "have":("Dolch primer",None),"of":("Fry first 100",None),"from":("Fry first 100",5),
 "what":("Dolch primer",None),"want":("Dolch primer",None),"this":("Dolch primer",4),
 "that":("Dolch primer",4),"with":("Dolch primer",4),"there":("Dolch primer",None),
 "all":("Dolch primer",3),"one":("Dolch pre-primer",None),"two":("Dolch pre-primer",None),
 "three":("Dolch pre-primer",8),"like":("Dolch primer",6),"little":("Dolch pre-primer",10),
 "into":("Dolch primer",None),"out":("Dolch primer",9),"now":("Dolch primer",9),
 "down":("Dolch pre-primer",9),
 "her":("Dolch grade 1",7),"him":("Dolch grade 1",3),"his":("Dolch grade 1",3),
 "had":("Dolch grade 1",3),"has":("Dolch grade 1",3),"by":("Dolch grade 1",8),
 "as":("Dolch grade 1",3),"an":("Dolch grade 1",1),"but":("Dolch primer",2),
 "new":("Dolch primer",9),"who":("Dolch primer",None),
 "some":("Dolch grade 1",None),"does":("Dolch grade 2",None),"were":("Dolch grade 1",None),
 "their":("Dolch grade 2",None),"been":("Dolch grade 2",8),"very":("Dolch grade 2",8),
 "four":("Dolch primer",None),"five":("Dolch grade 2",6),
 "again":("Dolch grade 1",None),"could":("Dolch grade 1",None),"would":("Dolch grade 2",None),
 "should":("Fry first 300",None),"other":("Fry first 100",None),"another":("Fry first 300",None),
 "oh":("Letters and Sounds Phase 5",None),"many":("Dolch grade 2",None),"any":("Dolch grade 1",None),
 "know":("Dolch grade 1",10),"your":("Dolch grade 2",None),"first":("Dolch grade 2",7),
 "every":("Dolch grade 1",None),"people":("Letters and Sounds Phase 5",None),
 "water":("Fry first 100",None),"where":("Dolch pre-primer",None),"about":("Dolch grade 3",10),
 "eight":("Dolch grade 3",None),"enough":("Fry first 300",None),"friend":("Fry first 300",None),
 "once":("Dolch grade 1",None),"only":("Dolch grade 3",None),
 "together":("Dolch grade 3",None),"thought":("Fry first 300",None),
 "through":("Fry first 300",None),"beautiful":("Fry first 500",None),
 "because":("Dolch grade 2",9),"different":("Fry first 300",None),
 "sure":("Fry first 300",None),"special":("Fry first 500",None),
 "usually":("Fry first 500",None),"laugh":("Dolch grade 3",None),
}
