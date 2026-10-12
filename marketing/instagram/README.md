# Swedeline on Instagram

Carousel posts that each teach one thing about Swedish words and end with a slide that points to the
extension. Posts are written into `posts/` (one JSON file each) and rendered into ready-to-upload PNGs
and a caption. A scheduled Claude task writes new posts every week, so the queue doesn't run dry.

## Daily routine (about two minutes)
1. Open `out/index.html` in your browser. The post at the top, outlined in yellow, is next.
2. In Meta Business Suite (desktop) or the Instagram app, start a new post and add the slides from
   `out/ready/<id>/` **in order** (`01.png`, `02.png`, …). The last slide is always the call to action.
   At the crop step, set the size to **Original** or **4:5**. Instagram defaults to a square and would
   cut off the top and bottom of the slides. On instagram.com, it's the button at the bottom left of
   the crop dialog.
3. Click **Copy caption** in the gallery and paste it. The caption already has the call to action
   ("link in bio") and the hashtags (5 at most, Instagram's limit).
4. Schedule it, or post it.
5. Move that post's folder from `out/ready/` to `out/posted/`. The next `npm run ig:render` drops it
   from the gallery and never renders it again.

You can schedule a whole week in one sitting. Just move each folder to `posted/` once it's scheduled.

To schedule from your phone, render straight into iCloud Drive:

```bash
IG_OUT="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Swedeline posts" npm run ig:render
```

## Quiz stories (2–3 a week, from your phone)
Each quiz in `quizzes/` renders to `out/stories/<id>/`. The gallery lists them under **Quiz stories**.
- `1-question.png`: the word plus a hint, with empty space under "Tap your answer" for the sticker.
- `2-answer.png`: the answer and a short explanation, with a Swedeline card at the bottom.
- `sticker.txt`: the question, the options and which one is correct.

1. Get the two PNGs onto your phone (AirDrop, or render into iCloud Drive with `IG_OUT`, see above).
2. In the Instagram app, start a story with `1-question.png`. Add a **Quiz** sticker in the empty
   space, type the question and options from `sticker.txt`, mark the right one, and share.
3. A few hours later, post `2-answer.png` as a story. If you like, add a **Link** sticker to the
   Chrome Web Store between the explanation and the Swedeline card.
4. Move the quiz's folder from `out/stories/` to `out/posted/`.

Quiz stickers only work in the app, so these can't be scheduled in Meta Business Suite. The answer
story can be, but it doesn't need to be.

## One-time profile setup
- **Profile picture:** `out/profile.png` (the icon on white, made for the round crop).
- **Name:** Swedeline · Learn Swedish
- **Bio** (suggestion):
  > Learn Swedish while you browse 🇸🇪
  > One Swedish word fact a day.
  > Free extension for Chrome & Firefox ↓
- **Link:** the Chrome Web Store listing, or a small link page with both the Chrome Web Store and
  Firefox Add-ons links. Every caption says "link in bio", so the link must always work.
- Switch to a professional (creator) account to get scheduling and post insights.

## Commands
| Command | What it does |
| --- | --- |
| `npm run ig:status` | Counts posts in the bank, posted and ready, and how many days that lasts |
| `npm run ig:check` | Validates every post: fields, lengths, repeated headwords, Swedish spelling and en/ett against the local dictionary data |
| `npm run ig:render` | Renders every unposted post into `out/ready/`, plus `out/index.html` and `out/profile.png` |
| `npm run ig:render -- --only 0007` | Re-renders a single post |

The spelling and en/ett checks use the WikDict and frequency data in `.cache/` (from `npm run dicts`).
Without it, `ig:check` still validates everything else.

## How new posts arrive
A scheduled Claude Code task, **Swedeline Instagram refill**, runs every Sunday at 10:00. It follows
the refill procedure in [GENERATE.md](GENERATE.md):
- If 21 or more posts are ready, it does nothing.
- Otherwise it writes new posts until 28 are ready, checks and renders them, and commits only the new
  files in `posts/` (only on `main`, never pushed).

You'll get a notification after each run. It runs while the Claude desktop app is open. If the app is
closed at that time, the task runs the next time you open it. The four-week buffer covers missed
weeks. Manage the task (run now, pause, change the time) under Scheduled tasks in the Claude app.

To edit a post, change its JSON in `posts/`, then run `npm run ig:check` and `npm run ig:render`. To
skip a post for good, delete its file, or move its folder to `posted/`.

## Files
- `GENERATE.md`: the content brief (voice, series, accuracy rules, format, refill steps). The refill
  task reads it on every run, so improve the posts by editing it.
- `posts/`: the content bank, committed.
- `out/`: rendered output, gitignored. `ready/` holds what's left to post, `posted/` what you've posted.
- `../../scripts/instagram.mjs`: checker and renderer. Slide design and the call-to-action slide live
  there, and brand colors in `../../scripts/brand.mjs`.
