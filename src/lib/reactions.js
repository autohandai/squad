// Reaction emoji, and turning a reaction into a flow without leaving the
// message (ADR-0053). Five stay on the hover row because a sixth is already a
// menu; the picker behind it carries the rest.

import { DEFAULT_TRIGGER_EMOJI, createWorkflowId, normalizeWorkflow, validateWorkflow } from "./workflows.js";

/** The hover row: the five you reach for without thinking. */
export const QUICK_REACTIONS = ["👀", "✅", "🎬", "❤️", "🚀"];

/**
 * Everything else, grouped so it can be scanned and named so it can be
 * searched — and so a screen reader has something to announce. Written as one
 * string per group ("<emoji> <name>" separated by "|") because a few hundred
 * two-element arrays is a page of punctuation nobody will keep tidy.
 */
const GROUP_SOURCE = [
  [
    "smileys",
    "Smileys",
    "😀 grin|😃 smile|😄 happy|😁 beam|😆 laugh|😅 sweat|🤣 rofl|😂 tears|🙂 slight|🙃 upside|😉 wink|😊 blush|😇 halo|🥰 adore|😍 hearteyes|🤩 star|😘 kiss|😗 kissing|😚 kissed|😋 yum|😛 tongue|😜 zany|🤪 wacky|😝 squint|🤑 money|🤗 hug|🤭 oops|🤫 shh|🤔 thinking|🤐 zipper|🤨 brow|😐 neutral|😑 expressionless|😶 speechless|😏 smirk|😒 unamused|🙄 eyeroll|😬 grimace|🤥 lying|😌 relieved|😔 pensive|😪 sleepy|🤤 drool|😴 sleeping|😷 mask|🤒 sick|🤕 hurt|🤢 queasy|🤮 vomit|🤧 sneeze|🥵 hot|🥶 cold|🥴 woozy|😵 dizzy|🤯 mindblown|🤠 cowboy|🥳 party|😎 cool|🤓 nerd|🧐 monocle|😕 confused|😟 worried|🙁 frown|😮 open|😯 hushed|😲 astonished|😳 flushed|🥺 pleading|😦 anguished|😧 anxious|😨 fearful|😰 anxioussweat|😥 sad|😢 cry|😭 sob|😱 scream|😖 confounded|😣 persevere|😞 disappointed|😓 downcast|😩 weary|😫 tired|🥱 yawn|😤 triumph|😡 pout|😠 angry|🤬 cursing|😈 imp|💀 skull|👻 ghost|👽 alien|🤖 robot|🎃 pumpkin|❤️ heart|🧡 orangeheart|💛 yellowheart|💚 greenheart|💙 blueheart|💜 purpleheart|🖤 blackheart|🤍 whiteheart|🤎 brownheart|💔 brokenheart|💕 twohearts|💖 sparkleheart|💗 growingheart|💘 cupid|💝 giftheart|💞 revolvinghearts|💓 beatingheart|💟 heartdecoration",
  ],
  [
    "gestures",
    "Gestures",
    "👍 yes|👎 no|👌 ok|🤌 pinched|🤏 small|✌️ victory|🤞 crossed|🫰 fingerscrossed|🤟 loveyou|🤘 rock|🤙 callme|👈 left|👉 right|👆 up|👇 down|☝️ point|✋ raised|🤚 back|🖐️ splayed|🖖 vulcan|👋 wave|🤝 handshake|🙏 thanks|✍️ writing|💅 nails|🤳 selfie|💪 muscle|🦾 mechanical|🧠 brain|👀 eyes|👁️ eye|🫡 salute|🫶 hearthands|🤲 palms|👏 clap|🙌 praise|👐 open|🙇 bow|🤦 facepalm|🤷 shrug|🙋 raisehand|🙆 okperson|🙅 noperson|💁 info|🧑‍💻 developer|👷 builder|🕵️ detective|💂 guard|🦸 hero|🧙 wizard|🧑‍🚀 astronaut|👮 police|🧑‍🔧 mechanic|🧑‍🍳 chef|🧑‍🏫 teacher|🧑‍⚖️ judge|👶 baby|🧓 elder",
  ],
  [
    "work",
    "Work",
    "🐛 bug|🪲 beetle|🧪 test|🔬 microscope|🔧 fix|🔨 hammer|🛠️ tools|⚙️ settings|🧰 toolbox|🪛 screwdriver|🚢 release|📦 package|🚀 ship|🛳️ deploy|🔒 security|🔓 unlocked|🔑 key|🗝️ oldkey|🛡️ shield|📝 notes|📄 document|📃 page|📑 tabs|🗂️ folders|📁 folder|📂 openfolder|🗃️ filebox|🗄️ cabinet|📊 metrics|📈 up|📉 down|📋 clipboard|📌 pin|📍 location|🖇️ clip|📎 paperclip|✂️ cut|🖊️ pen|🖋️ fountain|✏️ pencil|🧹 cleanup|🧽 sponge|🧼 soap|🪣 bucket|🏗️ refactor|🧱 brick|🔁 retry|🔂 repeat|🔄 sync|♻️ recycle|⏱️ stopwatch|⏲️ timer|⌛ hourglass|⏰ alarm|🗓️ calendar|📅 date|🔔 bell|🔕 muted|📣 announce|📢 loud|💬 comment|💭 thought|🗯️ shout|🧾 receipt|💼 briefcase|🏷️ label|🔖 bookmark",
  ],
  [
    "status",
    "Status",
    "✅ done|☑️ checked|✔️ check|❌ no|❎ cross|⛔ blocked|🚫 forbidden|⚠️ warning|❗ important|❕ notice|❓ question|❔ unsure|‼️ urgent|⁉️ interrobang|🟢 green|🟡 amber|🟠 orange|🔴 red|🔵 blue|🟣 purple|⚫ black|⚪ white|🟤 brown|🔺 uptriangle|🔻 downtriangle|🔸 smalldiamond|🔹 bluediamond|▶️ start|⏸️ paused|⏹️ stop|⏺️ record|⏭️ next|⏮️ previous|⏩ forward|⏪ rewind|🔼 increase|🔽 decrease|⏳ waiting|⌚ time|🆗 ok|🆕 new|🆙 up|🆒 cool|🆓 free|🔝 top|🔙 back|🔚 end|🔜 soon|🏁 finish|🎯 target|💯 hundred|🔥 fire|✨ sparkles|⭐ star|🌟 glow|💫 dizzy|⚡ performance|💥 boom|🎉 celebrate|🎊 confetti|🏆 trophy|🥇 gold|🥈 silver|🥉 bronze|🎖️ medal",
  ],
  [
    "objects",
    "Objects",
    "💡 idea|🔦 torch|🕯️ candle|🔌 plug|🔋 battery|🪫 lowbattery|💻 laptop|🖥️ desktop|🖨️ printer|⌨️ keyboard|🖱️ mouse|💾 save|💿 disc|📀 dvd|🧮 abacus|📱 phone|☎️ telephone|📞 call|📠 fax|📺 tv|📷 camera|📸 flash|🎥 movie|🎬 action|🎙️ mic|🎧 headphones|🔊 sound|🔇 mute|📡 satellite|🛰️ orbit|🧲 magnet|🔭 telescope|🧬 dna|💊 pill|🩺 stethoscope|🪙 coin|💰 money|💳 card|💎 gem|⚖️ balance|🧭 compass|🗺️ map|🪄 magic|🔮 crystal|🎲 dice|🧩 puzzle|🪜 ladder|🪑 chair|🛎️ bell|🚪 door|🪟 window|🧯 extinguisher|🪤 trap|🎁 gift|🎈 balloon|📮 postbox|✉️ mail|📧 email|📨 incoming|📤 outbox|📥 inbox",
  ],
  [
    "nature",
    "Nature",
    "🐶 dog|🐱 cat|🐭 mouse|🐹 hamster|🐰 rabbit|🦊 fox|🐻 bear|🐼 panda|🐨 koala|🐯 tiger|🦁 lion|🐮 cow|🐷 pig|🐸 frog|🐵 monkey|🙈 seenoevil|🙉 hearnoevil|🙊 speaknoevil|🐔 chicken|🐧 penguin|🐦 bird|🦆 duck|🦅 eagle|🦉 owl|🦇 bat|🐺 wolf|🐗 boar|🐴 horse|🦄 unicorn|🐝 bee|🦋 butterfly|🐌 snail|🐞 ladybird|🐜 ant|🕷️ spider|🦂 scorpion|🐢 turtle|🐍 snake|🦎 lizard|🐙 octopus|🦑 squid|🦀 crab|🐠 fish|🐬 dolphin|🐳 whale|🦈 shark|🐊 crocodile|🐘 elephant|🦏 rhino|🐪 camel|🦒 giraffe|🌵 cactus|🌲 tree|🌳 oak|🌴 palm|🌱 seedling|🌿 herb|☘️ clover|🍀 luck|🍁 maple|🍂 leaves|🌾 wheat|🌷 tulip|🌹 rose|🌻 sunflower|🌸 blossom|💐 bouquet|🌍 earth|🌙 moon|☀️ sun|⛅ cloudy|🌧️ rain|⛈️ storm|❄️ snow|🌊 wave|🌈 rainbow",
  ],
  [
    "food",
    "Food",
    "🍏 apple|🍊 orange|🍋 lemon|🍌 banana|🍉 watermelon|🍇 grapes|🍓 strawberry|🫐 blueberry|🍒 cherry|🍑 peach|🥭 mango|🍍 pineapple|🥥 coconut|🥝 kiwi|🍅 tomato|🥑 avocado|🥦 broccoli|🥕 carrot|🌽 corn|🌶️ chilli|🥔 potato|🍞 bread|🥐 croissant|🥨 pretzel|🧀 cheese|🥚 egg|🍳 fry|🥞 pancakes|🧇 waffle|🥓 bacon|🍔 burger|🍟 chips|🍕 pizza|🌭 hotdog|🌮 taco|🌯 burrito|🥗 salad|🍝 pasta|🍜 noodles|🍣 sushi|🍤 prawn|🍦 icecream|🍩 doughnut|🍪 biscuit|🎂 cake|🍫 chocolate|🍬 sweet|🍿 popcorn|☕ coffee|🍵 tea|🧋 bubbletea|🥤 softdrink|🍺 beer|🍻 cheers|🥂 toast|🍷 wine|🥃 whisky|🧊 ice",
  ],
  [
    "places",
    "Travel",
    "🚗 car|🚕 taxi|🚌 bus|🚎 trolley|🏎️ racecar|🚓 policecar|🚑 ambulance|🚒 firetruck|🚜 tractor|🛵 scooter|🏍️ motorbike|🚲 bicycle|🛴 kickscooter|✈️ plane|🛫 takeoff|🛬 landing|🚁 helicopter|🛸 ufo|⛵ sailboat|🚤 speedboat|⚓ anchor|🚂 train|🚆 railway|🚇 metro|🗽 liberty|🗼 tower|🏰 castle|🏠 house|🏡 home|🏢 office|🏭 factory|🏥 hospital|🏦 bank|🏨 hotel|🏫 school|⛺ tent|🏝️ island|🏔️ mountain|🌋 volcano|🏖️ beach|🌃 night|🌆 dusk|🌇 sunset|🌉 bridge",
  ],
  [
    "activity",
    "Activity",
    "⚽ football|🏀 basketball|🏈 americanfootball|⚾ baseball|🎾 tennis|🏐 volleyball|🏉 rugby|🎱 pool|🏓 pingpong|🏸 badminton|🥅 goal|⛳ golf|🏹 archery|🎣 fishing|🥊 boxing|🥋 martialarts|🛹 skateboard|⛸️ skating|🎿 ski|🏂 snowboard|🏋️ lifting|🤸 gymnastics|🤺 fencing|🏊 swimming|🚴 cycling|🧗 climbing|🧘 yoga|🎮 gaming|🕹️ joystick|🎰 slots|🎨 art|🎭 theatre|🎤 singing|🎸 guitar|🎹 piano|🥁 drums|🎺 trumpet|🎻 violin|♟️ chess|🃏 joker|🀄 mahjong",
  ],
];

function parseGroup(source) {
  return source
    .split("|")
    .map((entry) => {
      const gap = entry.indexOf(" ");
      return gap === -1 ? null : [entry.slice(0, gap), entry.slice(gap + 1)];
    })
    .filter(Boolean);
}

export const REACTION_GROUPS = GROUP_SOURCE.map(([id, label, source]) => ({ id, label, items: parseGroup(source) }));

export const ALL_REACTIONS = REACTION_GROUPS.flatMap((group) => group.items.map(([emoji]) => emoji));

const NAME_BY_EMOJI = new Map(REACTION_GROUPS.flatMap((group) => group.items.map(([emoji, name]) => [emoji, name])));

/** What to call this emoji out loud. Falls back to the emoji itself. */
export function reactionName(emoji) {
  return NAME_BY_EMOJI.get(emoji) || String(emoji || "");
}

/**
 * Groups filtered by name; an empty query returns every group. Matching is a
 * substring so "run" finds "running" and "fire" finds "firetruck", and an
 * emoji pasted into the box finds itself.
 */
export function searchReactions(query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return REACTION_GROUPS;
  return REACTION_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(([emoji, name]) => name.includes(needle) || emoji === needle),
  })).filter((group) => group.items.length);
}

// ---------------------------------------------------------------------------
// The lazy way: a flow built from the reaction you just used

/**
 * What a reaction can set off. `prompt` and `member` both become a member step
 * — a prompt is only a prompt once somebody is asked it — and differ in whether
 * you chose who. `url` becomes the http step kind.
 */
export const REACTION_ACTIONS = ["prompt", "member", "url"];

export function stepKindForAction(action) {
  return action === "url" ? "http" : "member";
}

function defaultName(emoji, action) {
  const name = reactionName(emoji);
  if (action === "url") return `${name} calls a URL`;
  if (action === "member") return `${name} asks a member`;
  return `${name} runs a prompt`;
}

/**
 * A workflow draft from a reaction, ready for the same save path the settings
 * sheet uses. Returns `{ draft, problems }`; `problems` is what
 * `validateWorkflow` said, so the caller never has to guess why a save failed.
 */
export function reactionFlowDraft({
  emoji = DEFAULT_TRIGGER_EMOJI,
  action = "prompt",
  memberId = "",
  prompt = "",
  url = "",
  method = "POST",
  name = "",
  workspace = "",
  now = Date.now(),
} = {}) {
  const chosen = REACTION_ACTIONS.includes(action) ? action : "prompt";
  const step =
    chosen === "url"
      ? { id: "step_1", kind: "http", url: String(url || "").trim(), method, headers: [], body: "" }
      : { id: "step_1", kind: "member", memberId, prompt: String(prompt || "").trim(), workspace };
  const draft = {
    id: createWorkflowId("wf", now),
    name: String(name || "").trim() || defaultName(emoji, chosen),
    enabled: true,
    trigger: { type: "reaction", emoji: String(emoji || DEFAULT_TRIGGER_EMOJI) },
    steps: [step],
  };
  const normalized = normalizeWorkflow(draft);
  return { draft: { ...normalized, name: draft.name }, problems: validateWorkflow(draft) };
}

/** The flows already listening for this emoji in this channel. */
export function flowsForReaction(workflows = [], emoji = "") {
  if (!emoji) return [];
  return workflows.filter((workflow) => workflow?.trigger?.type === "reaction" && workflow.trigger.emoji === emoji);
}
