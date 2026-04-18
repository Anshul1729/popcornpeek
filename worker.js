export default {
  async fetch(request, env) {
    // CORS preflight
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

    return cors(new Response('Not found', { status: 404 }));
  }
};

// POST /identify  { image: "<base64 jpeg>" }
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
            text: 'Look at this image carefully. Is there a movie or TV show poster, title, or any identifiable movie/show name visible — on a screen, physical poster, DVD cover, or anywhere? If yes, respond ONLY with valid JSON (no markdown, no extra text): {"found": true, "title": "Exact Title", "year": "YYYY"}. Omit year if not visible. If no movie or show is identifiable, respond ONLY with: {"found": false}'
          },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${body.image}` }
          }
        ]
      }],
      max_tokens: 80,
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

// GET /movie?title=Inception&year=2010
async function handleMovie(url, env) {
  const title = url.searchParams.get('title');
  const year  = url.searchParams.get('year');

  if (!title) return json({ error: 'No title provided' }, 400);

  let omdbUrl = `https://www.omdbapi.com/?t=${encodeURIComponent(title)}&apikey=${env.OMDB_API_KEY}&plot=short`;
  if (year) omdbUrl += `&y=${year}`;

  const res  = await fetch(omdbUrl);
  const data = await res.json();

  if (data.Response !== 'True') return json({ found: false });

  return json({
    found:   true,
    title:   data.Title,
    year:    data.Year,
    rating:  data.imdbRating  !== 'N/A' ? data.imdbRating  : null,
    plot:    data.Plot         !== 'N/A' ? data.Plot         : null,
    genre:   data.Genre        !== 'N/A' ? data.Genre        : null,
    runtime: data.Runtime      !== 'N/A' ? data.Runtime      : null,
  });
}

// Helpers
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
