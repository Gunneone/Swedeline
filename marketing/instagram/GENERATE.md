# Writing Swedeline Instagram posts

This brief is for Claude: the weekly scheduled task follows it, and so does anyone writing posts by hand.
Each post is one JSON file in `posts/`. `npm run ig:render` turns it into 1080×1350 slides plus a
caption. The call-to-action slide and the call-to-action lines in the caption are **added
automatically**, so never write them into a post.

## Goal and audience
The account promotes Swedeline, a free browser extension that swaps a few words on English, German,
French and Spanish pages for Swedish ones. Readers are English speakers who are curious about Swedish
or just starting to learn it. Every post teaches one small, true, surprising thing about Swedish words.
People should want to save it or send it to a friend.

## Voice
- Curious, warm and short. Write like a friend who loves words, not like a textbook.
- Plain English, short sentences, no jargon ("en-word" is fine, "common gender" is not).
- No exclamation marks on slides. At most one in the caption.
- No emoji on slides (they are images). Captions may use one or two.
- Don't be smug about English or mock Swedish. Don't make claims about "Swedes always…".

## Accuracy (most important)
A wrong fact on a language account is worse than no post. Rules:
1. Only write facts you are certain of. If you hesitate, drop the post and pick another word.
2. For "literal" meanings, use **transparent compounds**: split the word into its parts and translate
   each part (sköld + padda = shield + toad). Don't make claims about history or origin unless they are
   well documented and you can check them.
3. No folk etymology. "Gift means both poison and married" is fine. "Because marriage is poison" is not.
4. No statistics or dates unless certain. Prefer "most" or "many" to made-up percentages.
5. Check every claim that isn't obvious (origins, history, place names) with a web search when you
   can. If you can't confirm it, rewrite it without the claim or drop the post.
6. Swedish example sentences must be natural, correct modern Swedish that a native speaker would
   actually say. Keep them short and everyday.
7. en/ett must be right. `npm run ig:check` compares a hook's `article` with Wiktionary data.
8. Pronunciation (`say`) is optional and approximate. Give it only when it adds something (mostly in
   "Say it" posts), using simple English-style respelling with the stressed syllable in capitals, for
   example `say: "SHOO"` for *sju*. Never use IPA.
9. Vulgar or edgy words: translate them accurately and plainly, without censoring and without
   dwelling on them. Keep each post fine for a general audience. Classic false friends like *kiss*
   (pee), *fart* (speed) and *slut* (end) are fine. Slurs and sexual content are not.

## Series
Pick a series for each post. Never use the same series in two consecutive posts, and spread them
evenly. The series sets the label pill on every slide.

| `series` | Label | What it is | Ideas (check the bank first; don't repeat headwords) |
| --- | --- | --- | --- |
| `literally` | Literally | Compounds whose parts say something funny or vivid | glasögon, grönsak, ögonblick, vardagsrum, sjukhus, flygplats, kylskåp, sköldkörtel |
| `no-english-word` | No English word | Words English needs a whole sentence for | mys, fredagsmys, mångata, resfeber, döstädning, orka, hinna, sambo, påtår, allemansrätten |
| `false-friend` | False friend | Words that look English but mean something else | bra, rolig, eventuellt, glass, barn, slut, prick, kock, aktuell |
| `idiom` | Swedish idiom | Idioms with a vivid literal picture | lägga lök på laxen, sitta i smöret, kasta yxan i sjön, gå som katten kring het gröt, inte ha alla hästar hemma, nu ska du få se på andra bullar |
| `en-or-ett` | En or ett? | One noun gender fact or tip | definite endings -en/-et, ett-words that end in -um, how adjectives change, plurals |
| `say-it` | Say it | One pronunciation fact | the silent d/h/l/g in dj, hj, lj, gj (djur, hjärta, ljus), soft g (göra, ge), the tj-sound (tjugo, kjol), tonal pairs like *anden* |
| `swedish-in-english` | Swedish in English | English words borrowed from Swedish | orienteering, gravlax, moped, rutabaga (dialect *rotabagge*) |
| `word-story` | Word story | The story inside an everyday word | seasonal: jul, lucia, påsk, midsommar, kräftskiva (see the timing note below) |
| `cute-word` | Cute word | Sweet, cosy or funny-sounding words | mysig, gullig, kelig, busig, myspys |

New series need a code change (`SERIES` in `scripts/instagram.mjs`), so stick to these. The idea
lists are only a start. `npm run ig:check` rejects any headword that's already in the bank, so check
with `grep -ri '"<word>"' marketing/instagram/posts` before writing a post.

**Timing:** posts go out one a day, in number order. A new post goes live about as many days from now
as there are posts ready (see `npm run ig:status`). Write seasonal topics (jul in December, påsk,
midsommar in June, kräftskiva in August) only when they'll land in the right weeks, and never write
"today" or "this week" in a post.

## Post structure
- **Slide 1 is always a `hook`** and must teach the fact on its own. Many people only ever see slide 1
  in their feed. Show the Swedish word or phrase big, then one sentence that delivers the surprise.
- **Slides 2–4** go deeper: the breakdown, related words, an example sentence, or a short note.
  Use 2–4 of them, so a post has 3–5 slides of its own and 4–6 with the CTA.
- **End with an `example` slide** where it fits, so readers see the word in a real sentence.
- **Caption**: 2–4 short paragraphs. Restate the fact, add one extra tidbit that isn't on the slides,
  and end with a question that invites comments ("Which one would you use?"). No hashtags, no link,
  no call to action in the caption text: those are appended automatically.

## File format
File name: `posts/NNNN-slug.json`. NNNN continues from the highest existing number, and the slug is
the headword in lowercase ASCII (å/ä → a, ö → o, spaces → hyphens).

```json
{
  "id": "0031-glasogon",
  "series": "literally",
  "headwords": ["glasögon"],
  "slides": [
    { "type": "hook", "sv": "glasögon", "fact": "means glasses. Literally: _glass eyes_." },
    { "type": "breakdown", "sv": "glasögon", "parts": [{ "sv": "glas", "en": "glass" }, { "sv": "ögon", "en": "eyes" }],
      "literal": "glass eyes", "means": "glasses" },
    { "type": "example", "sv": "Har du sett mina *glasögon*?", "en": "Have you seen my glasses?" }
  ],
  "caption": "…",
  "hashtags": ["learnswedish", "swedishlanguage", "svenska", "swedishwords", "languagelearning"],
  "verified": []
}
```

Markup inside text: `*word*` puts a word in Swedeline's yellow marker (use it **only for Swedish**);
`_text_` shows English text in the accent blue (use it for the key English gloss). Straight quotes and
apostrophes become curly automatically.

| Slide `type` | Fields (characters, not counting markup) |
| --- | --- |
| `hook` | `sv` word or phrase (≤ 40), `fact` (≤ 150, starts lowercase if it continues the word, e.g. "means …"), optional `article` (`en`/`ett`, single nouns only), optional `say` (≤ 32) |
| `breakdown` | `sv` the whole word, `parts` 2–4 × {`sv` ≤ 20, `en` ≤ 24}, optional `literal` (≤ 40), `means` (≤ 40), `title` (default "Word math") |
| `list` | `title` (≤ 48), `items` 2–5 × {`sv` ≤ 32, `en` ≤ 40, optional `lit` ≤ 40 for a literal meaning} |
| `example` | `sv` sentence with the word marked (≤ 130), `en` translation (≤ 150), optional `note` (≤ 120), `title` (default "In a sentence") |
| `note` | `title` (≤ 48), `body` (≤ 320; a blank line starts a new paragraph) |

Other fields:
- `headwords`: every Swedish word or phrase the post is *about*. `ig:check` rejects a headword that
  any earlier post already used, which keeps refills from repeating themselves.
- `hashtags`: 3–5 lowercase tags without `#` (Instagram allows at most 5). Always include
  `learnswedish` and `svenska`, plus 1–3 that fit the post, like `swedishwords`, `swedishlanguage`,
  `swedishidioms`, `languagelearning`, `wordoftheday`, `etymology`, `falsefriends`.
- `verified`: Swedish words that `ig:check` doesn't know (rare words, inflected forms) and that you have
  double-checked. Adding a word here is a promise that it is spelled right.

## Self-review before running the checks
Read each post as a sceptical native Swedish speaker who is also an English editor:
- Is every fact true without hedging? Would a Swede nod, or wince?
- Is the Swedish natural, correctly spelled, with å/ä/ö in the right places?
- Does slide 1 teach something on its own?
- Is it short? Cut every word you can. The renderer shrinks long text, and text that doesn't fit at all
  fails the render.
- Is the series different from the post before it?

## Quiz stories (only on request)
Quizzes are 9:16 stories, one JSON file each in `quizzes/`, named `qNN-slug.json`. The weekly refill
doesn't write them; write more only when asked. All the accuracy rules above apply.

```json
{
  "id": "q13-example",
  "show": "*bläckfisk*",
  "hint": "A sea animal with a very honest name.",
  "question": "What is a bläckfisk?",
  "options": ["A blackbird", "An octopus", "A swordfish", "A jellyfish"],
  "answer": 1,
  "reveal": "*Bläckfisk* is an octopus. Literally it means _ink fish_."
}
```

- `show` (≤ 40) goes big on the question story. It's usually the Swedish word or phrase, marked.
- `hint` (≤ 90, optional) sits under it. Make it a nudge, not the answer.
- `question` (≤ 50) and `options` (2–4, each ≤ 30) are typed into Instagram's quiz sticker, so they
  must be plain text with no markup. `answer` is the index of the right option, counting from 0.
  Vary its position, and make the wrong options plausible or funny.
- `reveal` (20–220) explains the answer on the answer story, with one extra tidbit.
- Avoid words a post already covers. Quizzes should feel new.

## Refill procedure (what the scheduled task does)
Run everything from the repository root, `/Users/gunneone/Projects/trana`.

1. Run `npm run ig:status`. If it says **21 or more** posts are ready to post, stop and report the
   count. Nothing else to do.
2. Otherwise, read the existing posts in `posts/` (at least their `series` and `headwords`, and the
   last three in full to match the style). Then write new posts, numbered after the highest
   existing one, until 28 are ready to post. Follow the series rotation and every rule above.
3. Run `npm run ig:check`. Fix every ERROR. For every warning, either fix the word or confirm it's
   right and add it to that post's `verified` list. Repeat until it reports 0 errors and you have
   handled each warning.
4. Run `npm run ig:render`. If a slide's text doesn't fit, shorten it and render again. Open two or
   three of the new PNGs (`out/ready/<id>/01.png` and one other) and look at them.
5. Commit only the new post files: `git add marketing/instagram/posts` then
   `git commit -m "Add Instagram posts NNNN–NNNN" -- marketing/instagram/posts`. Do this only if the
   current branch is `main`. On any other branch, leave the files uncommitted and say so. Never push,
   and never touch other files.
6. Report: how many posts you added, their ids and headwords, and how many days of posts are ready.
