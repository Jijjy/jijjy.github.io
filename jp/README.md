# jp: image-pair slides

Add a slide: `jp/add_slide.sh <id> before.jpg after.jpg "日本語の文"` (makes 512×512 WebPs plus `ja.mp3` via VOICEVOX `/home/box/voicevox/say.py`), then add one entry at the top of `slides.json` (see script header; `audio` is optional). Commit and push.

Audio plays when a slide opens (after the first tap, since browsers block autoplay); 🔊 replays it.
