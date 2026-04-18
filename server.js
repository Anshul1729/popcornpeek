import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const GROQ_KEY = process.env.GROQ_API_KEY;
const OMDB_KEY = process.env.OMDB_API_KEY;
const PORT = process.env.PORT || 3000;

if (!GROQ_KEY || !OMDB_KEY) {
  console.error('Missing GROQ_API_KEY or OMDB_API_KEY in .env');
  process.exit(1);
}

// POST /identify  { image: "<base64 jpeg>" }
app.post('/identify', async (req, res) => {
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: 'No image provided' });

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
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
              image_url: { url: `data:image/jpeg;base64,${image}` }
            }
          ]
        }],
        max_tokens: 80,
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ error: err?.error?.message || `Groq ${response.status}` });
    }

    const data = await response.json();
    const text = (data.choices?.[0]?.message?.content || '').trim();

    let result;
    try {
      result = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*?\}/);
      result = match ? JSON.parse(match[0]) : { found: false };
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /movie?title=Inception&year=2010
app.get('/movie', async (req, res) => {
  const { title, year } = req.query;
  if (!title) return res.status(400).json({ error: 'No title provided' });

  try {
    let url = `https://www.omdbapi.com/?t=${encodeURIComponent(title)}&apikey=${OMDB_KEY}&plot=short`;
    if (year) url += `&y=${year}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.Response !== 'True') return res.json({ found: false });

    res.json({
      found: true,
      title: data.Title,
      year: data.Year,
      rating: data.imdbRating !== 'N/A' ? data.imdbRating : null,
      plot: data.Plot !== 'N/A' ? data.Plot : null,
      genre: data.Genre !== 'N/A' ? data.Genre : null,
      runtime: data.Runtime !== 'N/A' ? data.Runtime : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`PopcornPeek server running on http://localhost:${PORT}`));
