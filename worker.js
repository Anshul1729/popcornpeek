export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/identify') {
      return cors(await handleIdentify(request, env));
    }

    if (request.method === 'GET' && url.pathname === '/movie') {
      return cors(await handleMovie(url, env));
    }

    if (request.method === 'GET' && url.pathname === '/recommendations') {
      return cors(await handleRecommendations(url, env));
    }

    return cors(new Response('Not found', { status: 404 }));
  }
};

const PROMPT = `You are analyzing a camera image that shows a TV screen, streaming app, or movie posters.

Identify the MOST PROMINENT movie or TV show visible. It could be Bollywood, Hollywood, South Indian (Tamil, Telugu, Malayalam, Kannada), or any regional/international film.

Rules:
- Read ALL visible text carefully — Hindi (Devanagari), Tamil, Telugu, Malayalam, Kannada, Bengali, English
- Title may appear in any language — always return the most widely known ENGLISH title
- For Indian films use the official English title (e.g. "Pushpa 2: The Rule" not "पुष्पा 2")
- If multiple movies are visible, pick the one that is LARGEST, most CENTERED, or most clearly visible
- Use poster artwork as a strong clue — recognize famous movie posters even if text is unclear, blurry, or partially obscured
- Ignore streaming platform logos (Netflix, Prime, Hotstar, MX Player, etc.)
- Be confident: if you recognize the poster artwork, identify it even if the title text isn't fully readable

Respond with JSON only, no markdown, no commentary:
- If found: {"found": true, "title": "English Title", "year": "YYYY"}
- If nothing identifiable: {"found": false}
- Omit "year" if not visible or unknown.`;

async function handleIdentify(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  if (!body.image) return json({ error: 'No image provided' }, 400);

  const imageSize = Math.round(body.image.length * 0.75 / 1024);
  console.log(`[identify] Received image, ~${imageSize}KB base64`);

  // 1. Try Gemini 2.5 Flash first — best vision quality, especially for Indian scripts
  if (env.GEMINI_API_KEY) {
    const geminiResult = await tryGemini(body.image, env.GEMINI_API_KEY);
    if (geminiResult) {
      console.log(`[identify] Gemini returned:`, JSON.stringify(geminiResult));
      return json(geminiResult);
    }
    console.warn(`[identify] Gemini failed, falling back to Groq`);
  } else {
    console.warn(`[identify] GEMINI_API_KEY not set, using Groq`);
  }

  // 2. Fallback to Groq
  if (!env.GROQ_API_KEY) {
    return json({ error: 'No vision API keys configured' }, 500);
  }

  const groqResult = await tryGroq(body.image, env.GROQ_API_KEY);
  console.log(`[identify] Groq returned:`, JSON.stringify(groqResult));
  return json(groqResult);
}

async function tryGemini(imageBase64, apiKey) {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: PROMPT },
              { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 200,
            responseMimeType: 'application/json'
          }
        })
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[gemini] HTTP ${res.status}:`, errText.slice(0, 300));
      return null;
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    if (!text) {
      console.error(`[gemini] Empty response:`, JSON.stringify(data).slice(0, 300));
      return null;
    }

    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*?\}/);
      return match ? JSON.parse(match[0]) : null;
    }
  } catch (e) {
    console.error(`[gemini] Exception:`, e.message);
    return null;
  }
}

async function tryGroq(imageBase64, apiKey) {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
          ]
        }],
        max_tokens: 200,
        temperature: 0.1
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[groq] HTTP ${res.status}:`, errText.slice(0, 300));
      return { found: false, error: `Groq ${res.status}` };
    }

    const data = await res.json();
    const text = (data.choices?.[0]?.message?.content || '').trim();

    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*?\}/);
      return match ? JSON.parse(match[0]) : { found: false };
    }
  } catch (e) {
    console.error(`[groq] Exception:`, e.message);
    return { found: false, error: e.message };
  }
}

async function handleMovie(url, env) {
  const title = url.searchParams.get('title');
  const year  = url.searchParams.get('year');

  if (!title) return json({ error: 'No title provided' }, 400);

  // 1. Try OMDB exact match
  let omdbUrl = `https://www.omdbapi.com/?t=${encodeURIComponent(title)}&apikey=${env.OMDB_API_KEY}&plot=short`;
  if (year) omdbUrl += `&y=${year}`;
  const res = await fetch(omdbUrl);
  let data = await res.json();

  // 2. OMDB broad search fallback
  if (data.Response !== 'True') {
    const searchUrl  = `https://www.omdbapi.com/?s=${encodeURIComponent(title)}&apikey=${env.OMDB_API_KEY}&type=movie`;
    const searchRes  = await fetch(searchUrl);
    const searchData = await searchRes.json();

    if (searchData.Response === 'True' && searchData.Search?.length > 0) {
      const detailRes = await fetch(`https://www.omdbapi.com/?i=${searchData.Search[0].imdbID}&apikey=${env.OMDB_API_KEY}&plot=short`);
      data = await detailRes.json();
    }
  }

  // 3. OMDB found — return it
  if (data.Response === 'True') {
    return json({
      found:   true,
      source:  'imdb',
      title:   data.Title,
      year:    data.Year,
      rating:  data.imdbRating !== 'N/A' ? data.imdbRating : null,
      plot:    data.Plot        !== 'N/A' ? data.Plot        : null,
      genre:   data.Genre       !== 'N/A' ? data.Genre       : null,
      runtime: data.Runtime     !== 'N/A' ? data.Runtime     : null,
    });
  }

  // 4. Fallback to TMDB
  const tmdbSearch = await fetch(
    `https://api.themoviedb.org/3/search/movie?api_key=${env.TMDB_API_KEY}&query=${encodeURIComponent(title)}${year ? '&year=' + year : ''}`
  );
  const tmdbData = await tmdbSearch.json();
  const movie = tmdbData.results?.[0];

  if (movie) {
    const tmdbDetail = await fetch(
      `https://api.themoviedb.org/3/movie/${movie.id}?api_key=${env.TMDB_API_KEY}`
    );
    const detail = await tmdbDetail.json();

    const genres  = detail.genres?.map(g => g.name).join(', ') || null;
    const runtime = detail.runtime ? `${detail.runtime} min` : null;
    const rating  = movie.vote_average ? movie.vote_average.toFixed(1) : null;

    return json({
      found:   true,
      source:  'tmdb',
      title:   movie.title,
      year:    movie.release_date?.slice(0, 4) || null,
      rating,
      plot:    movie.overview || null,
      genre:   genres,
      runtime,
    });
  }

  return json({ found: true, source: 'none', title, year: year || null, rating: null, plot: null, genre: null, runtime: null });
}

async function handleRecommendations(url, env) {
  const title = url.searchParams.get('title');
  const year  = url.searchParams.get('year');
  if (!title) return json({ recommendations: [] });

  const searchRes  = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${env.TMDB_API_KEY}&query=${encodeURIComponent(title)}${year ? '&year=' + year : ''}`);
  const searchData = await searchRes.json();
  const movie      = searchData.results?.[0];
  if (!movie) return json({ recommendations: [] });

  const recRes  = await fetch(`https://api.themoviedb.org/3/movie/${movie.id}/recommendations?api_key=${env.TMDB_API_KEY}`);
  const recData = await recRes.json();

  const recommendations = (recData.results || [])
    .filter(m => m.poster_path && m.overview)
    .slice(0, 3)
    .map(m => ({
      title:    m.title,
      overview: m.overview.length > 140 ? m.overview.slice(0, 140) + '…' : m.overview,
      poster:   `https://image.tmdb.org/t/p/w200${m.poster_path}`,
      rating:   m.vote_average ? m.vote_average.toFixed(1) : null,
      year:     m.release_date?.slice(0, 4) || null,
    }));

  return json({ recommendations });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function cors(response) {
  const r = new Response(response.body, response);
  r.headers.set('Access-Control-Allow-Origin', '*');
  r.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return r;
}
