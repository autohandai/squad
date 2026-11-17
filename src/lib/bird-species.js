// The composed cast (ADR-0243): real birds from around the world, each one a
// line that bird-composer.js turns into a face. Recognisable from colour and
// one to three marks, like the hand-drawn 26 in bird-faces.js.
//
//   id | Label[/also known as] | shape body | beak colour [extra] | mark colour | …
//
// `id` is lowercase letters only: birdFromAvatar reads it out of
// /avatars/birds/<id>.webp. Marks: crest:<kind>, tail, eye rx/ry, and every
// kind in MARKS (bird-composer.js), drawn in the order written.

const SPECIES = `
scarletmacaw|Scarlet macaw|round #d8262c|bighook #efe6d8|spectacles #f4f1e8
blueyellowmacaw|Blue-and-yellow macaw|round #2a7fc4|bighook #26272b|breast #f2c12e|spectacles #f4f1e8
militarymacaw|Military macaw|round #5c9a3c|bighook #2b2c30|forehead #d8343a|spectacles #f1ece2
cockatoo|Sulphur-crested cockatoo|squat #f4f2ec|hook #2e3034|crest:fan #f3d02e
galah|Galah|round #e8758f|hook #eee5d6|cap #f6cbd6
cockatiel|Cockatiel|tall #b9b7b0|small #8c8a86|crest:plume #e9c63a|face #f2cf3a|cheek #e8753a
budgerigar|Budgerigar|round #6cc04a|drop #e3c88f|hood #f3df3a|cheek #3b5fc0|spots #26272b
rainbowlorikeet|Rainbow lorikeet|round #3f9b45|hook #e8432e|hood #3456b8|breast #f07a2a
eclectus|Eclectus parrot|round #3fae49|bighook #f39b2b|belly #d63a3a
africangrey|African grey parrot|round #9a9da3|hook #26272b|spectacles #e9e8e4
sunparakeet|Sun parakeet|round #f6b51e|hook #2b2c30|hood #f07a24
kaka|Kākā/Forest parrot|round #7a5a3a|hook #5a5e64|cap #b8b4a4|bib #c4552a
kakariki|Kākāriki/Red-crowned parakeet|round #4fa34a|hook #8a9aa8|cap #d8343a
easternrosella|Eastern rosella|round #d8302f|hook #efe6d8|breast #f3d33b|cheek #f4f1e8
crimsonrosella|Crimson rosella|round #c9232c|hook #efe6d8|cheek #3a6fd0
lovebird|Rosy-faced lovebird|round #5fb64a|drop #f0dcb0|face #f28a8f
yellowcrownedamazon|Yellow-crowned amazon|round #4c9a3c|hook #d9c7a8|cap #f2d33b
monkparakeet|Monk parakeet|round #77b552|hook #f0c88a|breast #c8ccc4
ringneck|Rose-ringed parakeet|round #7ac35a|hook #d8343a|collar #2b2c30
palmcockatoo|Palm cockatoo|squat #3a3b40|bighook #1d1e21|crest:fan #3a3b40|cheek #d8343a
ganggang|Gang-gang cockatoo|round #7d8088|hook #e8e0d0|crest:plume #d43a3a|hood #d43a3a
goldenconure|Golden parakeet|round #f6c81e|hook #e8d8c0
peregrine|Peregrine falcon|round #5b6573|drop #3a3d44|hood #2a2d33|bib #efeae0|eyering #f2c12e
kestrel|American kestrel|round #c8743a|drop #4a5262|cap #6d84b8|cheek #f4f1e8|moustache #26272b
goldeneagle|Golden eagle|round #6b4a2c|hook #f0b72a|cap #c8913c
osprey|Osprey|round #f2efe8|drop #26272b|crown #5a4632|stripe #4a3a2c
redtailedhawk|Red-tailed hawk|round #8a5a36|drop #3a3530|bib #f1e6d4|streaks #6b4426
barnowl|Barn owl|wide #d8a868|drop #e6c8a0|face #f6f1e8
snowyowl|Snowy owl|wide #f3f2ee|drop #3a3b40|spots #3a3b40|spectacles #f2c12e
greathornedowl|Great horned owl|wide #8a6a4a|drop #2a2a2a|crest:horns #5e4632|disc #d29a5a|throat #f0ebe0
burrowingowl|Burrowing owl|round #a07a52|small #c8b89a|spots #efe6d6|spectacles #f2c12e|brow #f4f1e8
eagleowl|Eurasian eagle-owl|wide #a0784c|drop #3a3530|crest:horns #6d5034|spectacles #f08a24
tawnyowl|Tawny owl|wide #9a6a3e|drop #d8c8a0|disc #c49464
secretarybird|Secretary bird|side #c8ccd0|sidehook #9aa0a8|crest:swept #26272b|spectacles #f08a24
condor|Andean condor|round #26272b|hook #d9cbb0|hood #8a5a50
kingvulture|King vulture|round #f2eee8|hook #d8343a|crest:comb #f08a24|hood #e8743a
philippineeagle|Philippine eagle|squat #c8a878|bighook #4e5a6a|crest:fan #8a6a40|bib #f2ede2
karearea|Kārearea/New Zealand falcon|round #4a4038|drop #f2c12e|bib #e8d8bc|moustache #1d1e21
kahu|Kāhu/Swamp harrier|round #8a6c48|drop #3a3530|face #c8a878
stellerseagle|Steller's sea eagle|round #3a3330|bighook #f2a51c|patches #f4f1e8
caracara|Crested caracara|round #f2ede2|hook #a8c0d0|cap #1d1e21|face #e8743a
europeanrobin|European robin|round #8a7558|tri #3a3530|front #e8743a
europeangoldfinch|European goldfinch|round #e9e2d6|cone #e9d8c0|cap #26272b|mask #d8343a
americangoldfinch|American goldfinch|round #f6d12a|cone #f0a868|cap #26272b
housesparrow|House sparrow|round #a8784c|cone #3a3a3a|cap #8a8e94|cheek #e8e2d6|throat #2a2a2c
songthrush|Song thrush|round #a08060|tri #6b5a4a|bib #f2e8d6|spots #5a4030
blackbird|Common blackbird|round #26272b|tri #f2a51c|eyering #f2b31c
starling|Common starling|round #3a3d4a|tri #f2c12e|spots #e8e0c8
myna|Common myna|round #6b4a3a|tri #f2c12e|hood #26272b|eyering #f2c12e
barnswallow|Barn swallow|round #2d3e7a|small #26272b|belly #f2e8d8|throat #c8402c
bluetit|Blue tit|round #f2d33b|small #3a3a3a|cap #3e7cc6|stripe #1f2a44|cheek #f4f1e8
greattit|Great tit|round #f2d33b|small #2a2a2a|hood #1d1e21|cheek #f4f1e8|tie #1d1e21
mockingbird|Northern mockingbird|round #9aa0a6|tri #2a2a2a|stripe #4a4e54|bib #ece9e2
easternbluebird|Eastern bluebird|round #3d6fc8|small #2a2a2a|breast #d9772f
indigobunting|Indigo bunting|round #2f4fb8|cone #8a9aa8
paintedbunting|Painted bunting|round #d8343a|cone #7a7d84|hood #3a54c0|eyering #d8343a
scarlettanager|Scarlet tanager|round #d8262c|cone #c8b89a
westerntanager|Western tanager|round #f2d33b|cone #c8b48a|hood #e8452c
baltimoreoriole|Baltimore oriole|round #f08a24|tri #7a7d84|hood #1d1e21
redwingedblackbird|Red-winged blackbird|round #26272b|tri #5a5b60|patches #d8262c
cedarwaxwing|Cedar waxwing|round #b89a74|small #2a2a2a|crest:peak #b89a74|mask #1d1e21|belly #ecd88a
flicker|Northern flicker|round #b89a7a|tri #3a3a3a|cap #8a8e94|moustache #d8343a|spots #1d1e21
downywoodpecker|Downy woodpecker|side #f2efe8|short #4a4b50|cap #26272b|crown #d8343a|stripe #26272b
pileatedwoodpecker|Pileated woodpecker|side #26272b|dagger #5a5b60|crest:peak #d8343a|brow #f4f1e8|moustache #d8343a
redheadedwoodpecker|Red-headed woodpecker|side #f4f1e8|short #4a4b50|hood #d0232c
acornwoodpecker|Acorn woodpecker|round #26272b|tri #6a6b70|crown #d8343a|forehead #f4f1e8|eyering #f4f1e8
greenwoodpecker|Green woodpecker|side #6b9a3c|dagger #4a4b50|cap #d8343a|stripe #26272b
stellersjay|Steller's jay|round #2a3a6a|tri #26272b|crest:peak #1d1e21|hood #1d1e21|brow #8ab0e8
eurasianjay|Eurasian jay|round #c8a090|tri #26272b|crest:tuft #e8dcd0|moustache #1d1e21|patches #3a6fd0
eurasianmagpie|Eurasian magpie|round #1d1e21|tri #4a4b50|belly #f4f1e8
australianmagpie|Australian magpie|side #1d1e21|dagger #d8d4cc|belly #f4f1e8
raven|Common raven|side #1d1e21|sidecone #3d3e44
hoodedcrow|Hooded crow|round #9aa0a6|tri #2a2a2a|hood #1d1e21
titmouse|Tufted titmouse|round #a8aeb6|small #3a3a3a|crest:peak #a8aeb6|bib #efe9e2
whitebreastednuthatch|White-breasted nuthatch|side #7a8aa0|short #3a3d44|front #f2efe8|cap #1d1e21
wren|Eurasian wren|round #9a6a44|small #6b5040|tail #8a5c3a|brow #e8d8b8
goldcrest|Goldcrest|round #9aa84a|small #3a3a3a|crown #f2c12e
bullfinch|Eurasian bullfinch|round #e8686a|cone #1d1e21|cap #1d1e21
chaffinch|Common chaffinch|round #c88a6a|cone #9aa0a8|cap #7a8aa8
hawfinch|Hawfinch|round #c88a5a|thick #a8a8b0|cap #a8643a|collar #9aa0a8
zebrafinch|Zebra finch|round #a8a8a8|cone #e8432e|cheek #e8843a|moustache #1d1e21
gouldianfinch|Gouldian finch|round #5fb64a|cone #f0dcc8|face #d8343a|bib #8a4ab8
javasparrow|Java sparrow|round #8a909a|cone #e86a7a|cap #1d1e21|cheek #f4f1e8|eyering #e86a7a
canary|Canary|round #f6dc3a|cone #f2c8a0
housefinch|House finch|round #9a7a5a|cone #a8a0a0|front #d8343a|streaks #7a5a3a
junco|Dark-eyed junco|round #5a5e66|cone #e8d8c8|belly #f2efe8
yellowwarbler|Yellow warbler|round #f2d33b|small #5a4a3a|streaks #c8582c
yellowthroat|Common yellowthroat|round #8a8a3a|small #2a2a2a|mask #1d1e21|breast #f2d33b
silvereye|Tauhou/Silvereye|round #7a9a3a|small #3a3a3a|eyering #f4f1e8|belly #c8b8a0
bellbird|Korimako/Bellbird|round #6b8a3a|tri #26272b|hood #5a5a7a
hihi|Hihi/Stitchbird|round #26272b|small #5a5b60|ear #f4f1e8|bib #e8b83a
tieke|Tīeke/Saddleback|round #1d1e21|tri #4a4b50|wattle #e8743a
kokako|Kōkako/Blue-wattled crow|round #5a6a7a|tri #26272b|mask #1d1e21|wattle #3a6fd0
rifleman|Tītipounamu/Rifleman|round #9ab83a|small #3a3a3a|brow #f4f1e8
tomtit|Miromiro/Tomtit|round #1d1e21|small #5a5b60|bib #f2e8c8
mohua|Mohua/Yellowhead|round #f2d33b|small #3a3a3a|belly #efe6c8
weka|Weka/Woodhen|side #8a6a44|short #c8a070|streaks #5a4630
kaki|Kakī/Black stilt|sidesmall #1d1e21|needle #3a3b40|eyering #d8343a
whio|Whio/Blue duck|side #6a7a8a|bill #e8e2d6|spots #8a4a3a
pateke|Pāteke/Brown teal|side #7a5a3a|bill #3a3a3a|eyering #f4f1e8
putangitangi|Pūtangitangi/Paradise shelduck|side #8a4a2c|bill #26272b|hood #f4f1e8
korora|Kororā/Little penguin|tall #4a6a9a|tri #26272b|breast #f4f1e8
hoiho|Hoiho/Yellow-eyed penguin|tall #6a7a8a|tri #d8c8b8|stripe #f2d33b|breast #f4f1e8
tawaki|Tawaki/Fiordland penguin|tall #2a2e36|tri #e8743a|brow #f2d33b|bib #f4f1e8
toroa|Toroa/Albatross|side #f4f1e8|sidehook #f0c8a0|brow #6a6e76
kuaka|Kuaka/Bar-tailed godwit|sidesmall #c8a070|upturn #d8889a|streaks #8a6a44
torea|Tōrea/Oystercatcher|side #1d1e21|dagger #e8432e|belly #f4f1e8|eyering #e8432e
matuku|Matuku/Bittern|sidesmall #a8844c|dagger #d8b85a|streaks #6a4a2c
kawau|Kawau/Shag|side #1d1e21|sidehook #8a8e94|throat #f2c12e
kotuku|Kōtuku/White heron|sidesmall #f4f1e8|dagger #f2c12e
tara|Tara/White-fronted tern|side #e8ecee|dagger #1d1e21|cap #1d1e21
karoro|Karoro/Black-backed gull|side #f4f1e8|sidehook #f2c12e|eyering #f2c12e
tuturiwhatu|Tūturiwhatu/Dotterel|side #c8b090|short #26272b|bib #e8843a
keelbilledtoucan|Keel-billed toucan|sidesmall #1d1e21|big #7cc04a|breast #f2d33b
aracari|Collared aracari|sidesmall #2a4a2a|big #e8d8b0|hood #1d1e21|bib #f2d33b
quetzal|Resplendent quetzal|round #2fa86a|small #f2c12e|crest:mohawk #2fa86a|belly #d8262c
hoatzin|Hoatzin|side #a8743a|short #3a3a3a|crest:spray #8a5a2a|spectacles #3a8ad0
cockoftherock|Andean cock-of-the-rock|side #f0641e|short #f2c12e|crest:fan #f0641e
bluefootedbooby|Blue-footed booby|side #d8c8a8|dagger #5a8ab8|streaks #8a7a64
scarletibis|Scarlet ibis|sidesmall #e8432e|curve #c8302c
spoonbill|Roseate spoonbill|sidesmall #f08aa6|spoon #c8c0b0
saffronfinch|Saffron finch|round #f6c81e|cone #c8b8a0|cap #f08a24
ticotico|Rufous-collared sparrow|round #a08868|cone #5a5a5a|crest:tuft #8a8e94|collar #c8743a
paradisetanager|Paradise tanager|round #1d1e21|small #4a4b50|hood #7ad84a|bib #3a8ad0
seriema|Red-legged seriema|side #c8b8a0|short #d8343a|crest:tuft #8a7a64|eyering #3a6fd0
guiracuckoo|Guira cuckoo|side #e8d8b8|short #f2c12e|crest:mohawk #d8743a|streaks #6a5a44
manakin|Swallow-tailed manakin|round #3a7ad0|small #26272b|hood #1d1e21|crown #d8262c
jabiru|Jabiru|sidesmall #f4f1e8|dagger #1d1e21|hood #1d1e21
jacana|Wattled jacana|side #5a2a1e|short #f2c12e|forehead #d8343a
motmot|Blue-crowned motmot|round #4fa04a|tri #26272b|crown #3a6fd0|mask #1d1e21
jacamar|Rufous-tailed jacamar|sidesmall #3a9a5a|needle #1d1e21|bib #c8582c|throat #f4f1e8
blackneckedswan|Black-necked swan|side #f4f1e8|bill #7a8a9a|hood #1d1e21|forehead #d8343a
magellanicpenguin|Magellanic penguin|tall #2a2e36|tri #3a3b40|brow #f4f1e8|breast #f4f1e8
incatern|Inca tern|side #5a5e6a|short #d8343a|moustache #f4f1e8
vermilionflycatcher|Vermilion flycatcher|round #e8302a|small #26272b|stripe #4a3530
greenhoneycreeper|Green honeycreeper|round #3ab89a|tri #f2c12e|hood #1d1e21
redleggedhoneycreeper|Red-legged honeycreeper|round #3a4ad0|tri #26272b|crown #6ad8f0|stripe #1d1e21
shoebill|Shoebill|wide #8a9aa8|bighook #c8b890|crest:tuft #8a9aa8
greycrownedcrane|Grey crowned crane|side #9aa0a8|short #3a3a3a|crest:spray #e8c86a|cap #1d1e21|cheek #f4f1e8|wattle #d8343a
redcrownedcrane|Red-crowned crane|sidesmall #f4f1e8|dagger #8a9a6a|crown #d8343a|breast #1d1e21
lilacroller|Lilac-breasted roller|round #8aa8c8|tri #26272b|cap #7ac0a8|breast #b07ab8
hoopoe|Eurasian hoopoe|side #d8a070|curve #3a3a3a|crest:fan #c88a58
groundhornbill|Southern ground hornbill|side #1d1e21|big #3a3b40|spectacles #d8343a|wattle #d8343a
greathornbill|Great hornbill|sidesmall #1d1e21|big #f2c12e|collar #f2e6a8|casque #f2a51c
malachitekingfisher|Malachite kingfisher|round #3a7ad0|long #d8343a|crest:tuft #3a9ab0|breast #e8843a
commonkingfisher|Common kingfisher|side #2a8ad0|dagger #26272b|breast #e8843a|cheek #e8843a
kookaburra|Laughing kookaburra|side #e8e0cc|dagger #3a3a3a|cap #8a6a4c|stripe #6a4a2c
beeeater|European bee-eater|side #3ab0a0|curve #26272b|cap #a8582c|stripe #1d1e21|throat #f2d33b
fairywren|Superb fairywren|round #8a7a64|small #26272b|cap #4ac0e8|stripe #1d2a5a
emu|Emu|side #6a5a4a|short #3a3a3a|front #5a6a8a
cassowary|Southern cassowary|tall #1d1e21|tri #4a4b50|crest:helmet #a8846a|hood #3a7ad0|wattle #d8262c
ostrich|Ostrich|sidesmall #c8b8a8|short #e8b8a0|collar #f4f1e8|eyering #3a3530
mandarinduck|Mandarin duck|side #e8743a|bill #d8343a|cap #5a3a7a|brow #f4f1e8|cheek #f2a560
mallard|Mallard|side #2a7a4a|bill #f2c12e|collar #f4f1e8
woodduck|Wood duck|side #2a5a4a|bill #d8343a|crest:swept #2a5a4a|brow #f4f1e8|eyering #d8343a
muteswan|Mute swan|side #f4f1e8|bill #f08a24|forehead #1d1e21
blackswan|Black swan|side #26272b|bill #d8262c|eyering #d8262c
canadagoose|Canada goose|side #3a3530|bill #1d1e21|cheek #f4f1e8|belly #c8b8a0
tuftedpuffin|Tufted puffin|round #1d1e21|thick #f08a24|crest:swept #f2d33b|face #f4f1e8
gannet|Northern gannet|side #f4f1e8|dagger #a8b8c8|cap #f2d88a|eyering #3a6fd0
brownpelican|Brown pelican|side #c8c0b0|pouch #8a7a6a #6a5a4a|cap #f2e8c0
australianpelican|Australian pelican|side #f4f1e8|pouch #f0b8a0 #e89aa0|eyering #f2c12e
frigatebird|Great frigatebird|side #1d1e21|sidehook #5a5e66|breast #d8262c
emperorpenguin|Emperor penguin|tall #1d1e21|tri #f08a24|ear #f2c12e|breast #f4f1e8
rockhopper|Rockhopper penguin|tall #26272b|tri #d8343a|crest:swept #f2d33b|brow #f2d33b|breast #f4f1e8
gentoo|Gentoo penguin|tall #2a2e36|tri #f08a24|brow #f4f1e8|breast #f4f1e8
adelie|Adélie penguin|tall #1d1e21|tri #3a3b40|eyering #f4f1e8|breast #f4f1e8
africanpenguin|African penguin|tall #1d1e21|tri #26272b|brow #f4f1e8|breast #f4f1e8|spots #1d1e21
peafowl|Indian peafowl|round #2a5ab8|tri #c8b8a0|crest:wisp #2a5ab8|brow #f4f1e8
goldenpheasant|Golden pheasant|round #d8262c|tri #f2c12e|hood #f2c12e
pheasant|Common pheasant|side #2a5a4a|short #d8c8a0|spectacles #d8262c|collar #f4f1e8
turkey|Wild turkey|round #5a7ab8|tri #c8b8a0|wattle #d8262c|forehead #d8262c
rooster|Junglefowl/Rooster|side #c8743a|short #f2c12e|crest:comb #d8262c|wattle #d8262c
quail|California quail|round #7a8090|small #26272b|crest:plume #26272b|brow #f4f1e8
guineafowl|Helmeted guineafowl|round #3a3e4a|tri #d8c8b0|crest:helmet #c8a86a|spots #f4f1e8|wattle #d8343a
rockpigeon|Rock pigeon|round #8a92a0|tri #3a3b40|collar #5aa88a|eyering #f08a24
mourningdove|Mourning dove|round #c8b098|small #3a3a3a|eyering #8ab0d8
crownedpigeon|Victoria crowned pigeon|round #6a8ab8|tri #3a3b40|crest:spray #a8c0e8|stripe #1d2a4a|belly #8a3a5a
sacredibis|Sacred ibis|sidesmall #f4f1e8|curve #1d1e21|hood #1d1e21
greyheron|Grey heron|sidesmall #a8aeb6|dagger #f2c12e|crest:swept #1d1e21|stripe #1d1e21
nightheron|Black-crowned night heron|side #a8aeb6|dagger #26272b|crest:swept #f4f1e8|cap #2a3a4a|eyering #d8262c
marabou|Marabou stork|side #d8b8a8|dagger #c8c0b0|collar #f4f1e8
whitestork|White stork|sidesmall #f4f1e8|dagger #d8343a
loon|Common loon|side #1d1e21|dagger #26272b|collar #f4f1e8|spectacles #d8262c
crestedgrebe|Great crested grebe|side #e8e0d4|dagger #d8889a|crest:swept #3a2e28|cap #3a2e28|cheek #d8743a
annashummingbird|Anna's hummingbird|sidesmall #4a9a5a|needle #1d1e21|hood #d83a7a
swordbill|Sword-billed hummingbird|sidesmall #3a7a4a|needle #26272b|cap #8a6a3a
sunbird|Purple sunbird|sidesmall #3a2a6a|curve #1d1e21|breast #6a3ab8
cuckoo|Common cuckoo|round #8a929c|small #3a3a3a|belly #efe9e2|eyering #f2c12e
frogmouth|Tawny frogmouth|wide #8a8278|drop #6a6058|streaks #5a5048|spectacles #f2c12e
swift|Common swift|round #3a3530|small #6a6560|eyering #e8e0d4
skylark|Eurasian skylark|round #a88a64|small #6a5a44|crest:tuft #8a6c48|streaks #6a5038
nightingale|Common nightingale|round #a07a58|small #6a5040|belly #e8dcc8
bluethroat|Bluethroat|round #8a7058|small #3a3a3a|breast #3a6fd0|belly #e8dcc8|brow #f4f1e8
leiothrix|Red-billed leiothrix|round #7a8a3a|small #d8262c|throat #f2c12e|bib #e8843a
longtailedtit|Long-tailed tit|round #f2ede8|small #26272b|tail #3a3a3a|brow #1d1e21|cheek #f2c8c8
beardedreedling|Bearded reedling|round #c8a07a|small #f2a51c|cap #a8b0c0|moustache #1d1e21
bulbul|Red-whiskered bulbul|round #8a6a50|small #26272b|crest:peak #1d1e21|cap #1d1e21|cheek #f4f1e8|ear #d8262c
greenmagpie|Common green magpie|round #4ab86a|tri #d8262c|stripe #1d1e21|eyering #d8262c
goldenoriole|Eurasian golden oriole|round #f2d33b|tri #d8445a|stripe #1d1e21
monal|Himalayan monal|round #3a8a6a|hook #5a5e66|crest:wisp #3a8a6a|spectacles #3a7ad0
whitethroatedkingfisher|White-throated kingfisher|side #8a4a2c|dagger #d8262c|throat #f4f1e8|cap #6a3a24
hoodedpitta|Hooded pitta|round #4ab86a|small #26272b|hood #1d1e21|cap #8a5a2a
avocet|Pied avocet|sidesmall #f4f1e8|upturn #1d1e21|cap #1d1e21
stilt|Black-winged stilt|sidesmall #f4f1e8|needle #1d1e21|cap #3a3b40|eyering #d8262c
curlew|Eurasian curlew|sidesmall #b8987a|curve #5a4a3a|streaks #6a5038
killdeer|Killdeer|side #a8845a|short #1d1e21|collar #1d1e21|brow #f4f1e8|eyering #e8432e
lapwing|Northern lapwing|side #2a5a4a|short #26272b|crest:swept #1d1e21|cheek #f4f1e8|belly #f4f1e8
woodcock|Eurasian woodcock|side #b08a5a|dagger #8a6a4a|cap #6a4a2c|eye 2.6/5.6
silvergull|Tarāpunga/Red-billed gull|side #f4f1e8|short #d8262c|eyering #d8262c
arctictern|Arctic tern|side #e8ecee|dagger #d8262c|cap #1d1e21
bowerbird|Satin bowerbird|round #2a2a5a|tri #e8e0a8|spectacles #6a5ad0
noisyminer|Noisy miner|round #a8aeb6|tri #f2c12e|cap #1d1e21|spectacles #f2c12e
williewagtail|Willie wagtail|round #1d1e21|small #5a5b60|brow #f4f1e8|belly #f4f1e8
spinifexpigeon|Spinifex pigeon|round #c88a5a|small #3a3a3a|crest:peak #c88a5a|spectacles #d8262c
meadowlark|Western meadowlark|round #a88a5a|tri #6a6a6a|breast #f2d33b|collar #1d1e21
beltedkingfisher|Belted kingfisher|side #5a7ab0|dagger #26272b|crest:tuft #5a7ab0|collar #f4f1e8
catbird|Grey catbird|round #7a7e86|small #26272b|cap #1d1e21
mountainbluebird|Mountain bluebird|round #7ab8e8|small #26272b|belly #c8e0f0
sandhillcrane|Sandhill crane|sidesmall #a8aeb6|dagger #3a3b40|cap #d8262c|cheek #f4f1e8
harlequinduck|Harlequin duck|side #3a4a6a|bill #3a3b40|brow #f4f1e8|cheek #f4f1e8|ear #f4f1e8
hoodedmerganser|Hooded merganser|side #1d1e21|short #4a4b50|crest:mohawk #f4f1e8|cheek #f4f1e8
ruddyduck|Ruddy duck|side #8a3a2a|bill #5aa0e0|cap #1d1e21|cheek #f4f1e8
shoveler|Northern shoveler|side #2a6a4a|bill #3a3b40|spectacles #f2c12e
whitewagtail|White wagtail|round #f4f1e8|small #26272b|cap #1d1e21|bib #1d1e21
greenfinch|European greenfinch|round #8aa83a|cone #e8d8c8
siskin|Eurasian siskin|round #c8d83a|small #3a3a3a|cap #1d1e21
linnet|Common linnet|round #a8846a|cone #6a6a6a|forehead #d8343a|breast #e8a8a0
yellowhammer|Yellowhammer|round #f2d33b|cone #8a9aa8|streaks #a8743a
redstart|Common redstart|round #8a929c|small #26272b|mask #1d1e21|forehead #f4f1e8|breast #e8743a
dipper|White-throated dipper|round #4a3a30|small #26272b|breast #f4f1e8
eurasiannuthatch|Eurasian nuthatch|side #7a8aa0|short #3a3d44|stripe #1d1e21|belly #e8b88a
jackdaw|Western jackdaw|round #3a3d44|small #1d1e21|collar #a8aeb6|eyering #e8ecee
redkite|Red kite|round #b8643a|drop #f2c12e|hood #d8d8d0
capercaillie|Western capercaillie|round #2a2e36|drop #e8e0d0|brow #d8262c|throat #1d1e21
ptarmigan|Willow ptarmigan|round #f4f1e8|small #26272b|brow #d8262c
crestedibis|Crested ibis|sidesmall #f4e8e4|curve #1d1e21|crest:swept #f4e8e4|face #d8343a
barbet|Blue-throated barbet|round #4ab84a|tri #c8c8c0|face #4a9ad8|crown #d8262c
shrike|Red-backed shrike|round #a8aeb6|drop #26272b|mask #1d1e21|belly #f2d8d0
bluemagpie|Red-billed blue magpie|round #3a6ab8|tri #d8262c|hood #1d1e21|crown #e8ecee
superbstarling|Superb starling|round #3a7ab8|tri #26272b|belly #e8843a|collar #f4f1e8|spectacles #f2e6a8
redbishop|Southern red bishop|round #e8432e|cone #1d1e21|mask #1d1e21|belly #1d1e21
villageweaver|Village weaver|round #f2c12e|cone #1d1e21|hood #1d1e21
quelea|Red-billed quelea|round #c8a07a|cone #e8432e|face #1d1e21
hamerkop|Hamerkop|side #8a6a44|short #26272b|crest:swept #8a6a44
turaco|Knysna turaco|round #4ab84a|small #d8262c|crest:peak #4ab84a|brow #f4f1e8|spectacles #d8262c
carminebeeeater|Carmine bee-eater|side #d8344a|curve #1d1e21|stripe #1d1e21|throat #e8607a
kagu|Kagu|side #c8ccd0|short #e8743a|crest:swept #a8aeb6
wilsonsbirdofparadise|Wilson's bird-of-paradise|round #1d1e21|small #4a4b50|crown #3a8ad0|collar #f2d33b
birdofparadise|Greater bird-of-paradise|round #8a5a2a|small #8ab0c8|tail #f2d88a|hood #f2d33b|bib #2a8a5a
redcrestedcardinal|Red-crested cardinal|round #a8aeb6|cone #f0e0c8|crest:peak #d8262c|hood #d8262c|breast #f4f1e8
rosebreastedgrosbeak|Rose-breasted grosbeak|round #1d1e21|thick #f0e6d4|belly #f4f1e8|tie #d8343a
eveninggrosbeak|Evening grosbeak|round #c8a82a|thick #d8e0a0|cap #1d1e21|brow #f2d33b
blackburnianwarbler|Blackburnian warbler|round #2a2a2a|small #4a4b50|face #f08a24|stripe #1d1e21
scarletrobin|Scarlet robin|round #26272b|small #5a5b60|breast #d8343a|forehead #f4f1e8
snowbunting|Snow bunting|round #f4f1e8|small #26272b|cap #c8a07a
razorbill|Razorbill|side #1d1e21|sidehook #3a3b40|belly #f4f1e8|brow #f4f1e8
smew|Smew|side #f4f1e8|bill #5a5e66|spectacles #1d1e21|crest:mohawk #f4f1e8
goldeneye|Common goldeneye|side #1f3a2e|bill #1d1e21|cheek #f4f1e8|spectacles #f2c12e
shelduck|Common shelduck|side #2a5a3a|bill #d8262c|collar #b5673a|belly #f4f1e8
egyptiangoose|Egyptian goose|side #c8b090|bill #e8a0a0|spectacles #8a4a2a
barnaclegoose|Barnacle goose|side #f4f1e8|bill #1d1e21|cap #1d1e21|breast #1d1e21
barheadedgoose|Bar-headed goose|side #f4f1e8|bill #f2c12e|crown #1d1e21|belly #9aa0a8
baldibis|Northern bald ibis|sidesmall #26272b|curve #d8343a|crest:swept #26272b|hood #d8343a
rhinohornbill|Rhinoceros hornbill|sidesmall #1d1e21|big #f2c12e|casque #e8432e|belly #f4f1e8
piedkingfisher|Pied kingfisher|side #f4f1e8|dagger #1d1e21|cap #1d1e21|spots #1d1e21
bateleur|Bateleur|round #1d1e21|hook #f2c12e|face #d8343a
lammergeier|Bearded vulture|round #e8a86a|hook #8a8e94|stripe #1d1e21|moustache #1d1e21|eyering #d8262c
spectacledowl|Spectacled owl|wide #4a3a2c|drop #e8e0c8|brow #f4f1e8|breast #e8d8a8|eyering #f4f1e8
screechowl|Eastern screech owl|squat #8a8e94|drop #3a3b40|crest:horns #6a6e74|spectacles #f2c12e
moorhen|Common moorhen|round #2a2e36|none|shield #d8262c
coot|Eurasian coot|round #1d1e21|none|shield #f4f1e8
purplegallinule|Purple gallinule|round #5a3ab8|none|shield #8ac0e8|belly #2a6a4a
greenwingedteal|Green-winged teal|side #8a4a2c|bill #1d1e21|stripe #2a8a5a
`;

/** Parse the table into { id, label, aliases, spec } for bird-composer.js. */
export const COMPOSED_BIRDS = SPECIES.trim().split('\n').map(line => {
  const [id, names, head, beak, ...rest] = line.split('|');
  const [label, ...aliases] = names.split('/');
  const [shape, body] = head.split(' ');
  const spec = { shape, body, beak: beak.split(' '), marks: [] };
  for (const token of rest) {
    const [kind, ...values] = token.split(' ');
    if (kind.startsWith('crest:')) spec.crest = [kind.slice(6), values[0]];
    else if (kind === 'tail') spec.tail = values[0];
    else if (kind === 'eye') spec.eye = values[0].split('/').map(Number);
    else spec.marks.push([kind, values[0]]);
  }
  return { id, label, aliases, spec };
});
