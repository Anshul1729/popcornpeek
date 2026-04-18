# 🍿 PopcornPeek

> Point your camera at any movie poster or TV screen. Get the IMDb rating instantly.

---

## Demo

![PopcornPeek in action](demo.png)

---

## The problem

You know that moment — you're scrolling through Prime, Netflix, or any streaming app, and you see a movie you *kind of* want to watch. But you're not sure if it's worth your time.

So you pick up your phone, open the browser, type the movie name (which you might not even spell right), find the IMDb page, and *finally* check the rating.



That's way too many steps for a simple question: **is this movie good?**

---

## What is PopcornPeek?

PopcornPeek is a tiny web app that opens your camera and automatically identifies any movie poster or title visible on your screen — and instantly shows you:

- ⭐ IMDb rating
- 📝 Short plot summary
- 🎭 Genre tags
- ⏱ Runtime

No typing. No searching. Just point and peek.

---

## How it works

```
Camera frame → Groq Vision AI (Llama 4) → Movie title identified
                                                    ↓
                                          OMDB API → IMDb rating + plot
                                                    ↓
                                          Shown on screen in ~2 seconds
```

1. The app captures a frame from your camera every 4 seconds
2. Sends it to **Groq's Llama 4 Vision model** (free, blazing fast) which reads the movie title — even in Hindi, Tamil, Telugu, or other scripts
3. Looks up the movie on **OMDB** to fetch the IMDb rating and plot
4. Displays the info as an overlay on the live camera feed

The backend runs as a **Cloudflare Worker** — zero cold starts, always instant.

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | Vanilla HTML/CSS/JS — no framework |
| Vision AI | Groq API — Llama 4 Scout Vision (free tier) |
| Movie data | OMDB API (free tier) |
| Backend | Cloudflare Workers |
| Hosting | GitHub Pages |

---

## Try it

**[popcornpeek.vercel.app](https://popcornpeek.vercel.app)**

Open on your phone, hit **Start Camera**, and point it at any movie poster or streaming screen.

Works with Bollywood, Hollywood, South Indian films, and more.

---

## Run it yourself

### 1. Clone the repo
```bash
git clone https://github.com/Anshul1729/popcornpeek.git
cd popcornpeek
npm install
```

### 2. Get free API keys
- **Groq** — [console.groq.com](https://console.groq.com) (free, no credit card)
- **OMDB** — [omdbapi.com](https://omdbapi.com) (free, 1000 req/day)

### 3. Deploy the backend to Cloudflare Workers
```bash
npx wrangler login
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put OMDB_API_KEY
npx wrangler deploy
```

### 4. Update the worker URL in `index.html`
```js
const apiBase = 'https://popcornpeek.<your-account>.workers.dev';
```

Then open `index.html` in any browser — done.

---

## Limitations

- IMDb ratings may not be available for very new or regional films not yet listed on OMDB
- Camera focus depends on your device hardware
- Groq free tier has rate limits (but generous enough for personal use)

---

Built in an evening because I was too lazy to Google movie ratings. 🎬
