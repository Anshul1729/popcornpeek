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

async function handleIdentify(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  if (!body.image) return json({ error: 'No image provided' }, 400);

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `You are analyzing a camera image that likely shows a TV screen or streaming app with movie/show thumbnails.

Your job: identify the MOST PROMINENT movie or TV show visible. It could be Bollywood, Hollywood, South Indian (Tamil, Telugu, Malayalam, Kannada), or any regional language film.

Rules:
- Read ALL text carefully including Hindi (Devanagari script), Tamil, Telugu, or other scripts
- The title may appear in English, Hindi, or regional language — always return the most widely known English title
- If multiple movies are visible, pick the one that is largest or most centered
- For Bollywood/Indian films, use the official English title (e.g. "Pushpa 2 The Rule" not "पुष्पा 2")
- Ignore streaming platform logos (Netflix, Prime, MX Player etc.)

Respond ONLY with valid JSON, no markdown:
If found: {"found": true, "title": "English Title", "year": "YYYY"}
If not found: {"found": false}
Omit year if not visible.`
          },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${body.image}` }
          }
        ]
      }],
      max_tokens: 100,
      temperature: 0.1
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return json({ error: err?.error?.message || `Groq ${res.status}` }, 502);
  }

  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content || '').trim();

  try {
    return json(JSON.parse(text));
  } catch {
    const match = text.match(/\{[\s\S]*?\}/);
    return json(match ? JSON.parse(match[0]) : { found: false });
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
    // Fetch full details for runtime + genres
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

  // 5. Nothing found anywhere — still show the title
  return json({ found: true, source: 'none', title, year: year || null, rating: null, plot: null, genre: null, runtime: null });
}

// GET /recommendations?title=Inception&year=2010
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
