const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY || 'YOUR_GROQ_API_KEY_HERE';
const MODEL = 'llama-3.3-70b-versatile';

const SYSTEM_PROMPT = `You are RuralHealth AI, an assistant ONLY for trained community health workers in rural areas.

STRICT RULES — NEVER BREAK THESE:
1. NEVER diagnose. Never say "you have [disease]". Always say "this may suggest" or "this needs attention".
2. NEVER recommend specific medicines. Never name drugs. If you would mention a drug, say "[medicine - consult doctor]" instead.
3. Every response MUST end with: "⚠️ This is NOT a diagnosis. Always consult a doctor."
4. Keep responses simple — this is for rural health workers, not doctors.
5. If there is ANY sign of emergency (chest pain, difficulty breathing, unconscious, heavy bleeding, seizure, stroke, not breathing, severe burn), say "CALL 108 IMMEDIATELY" at the very start.
6. Use plain language. No complex medical jargon.
7. Be concise — max 200 words.
8. Structure your response with clear sections if needed.`;

function callGroqAPI(messages, callback) {
  const body = JSON.stringify({
    model: MODEL,
    max_tokens: 500,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages
    ]
  });

  const options = {
    hostname: 'api.groq.com',
    path: '/openai/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.choices && parsed.choices[0]) {
          callback(null, parsed.choices[0].message.content);
        } else {
          callback(new Error('Invalid API response: ' + data));
        }
      } catch (e) {
        callback(new Error('Parse error: ' + e.message));
      }
    });
  });

  req.on('error', callback);
  req.write(body);
  req.end();
}

// Sanitize AI response — strip medicine names (basic heuristic)
const MEDICINE_PATTERNS = [
  /\b(paracetamol|acetaminophen|ibuprofen|aspirin|amoxicillin|metformin|amlodipine|atorvastatin|omeprazole|ciprofloxacin|azithromycin|doxycycline|metronidazole|chloroquine|artemisinin|ORS|oral rehydration salts|zinc|vitamin [A-Z]|iron tablets?|folic acid|antacid|antibiotic|antifungal|antiviral|antihistamine|decongestant|loperamide|ondansetron|diazepam|phenobarbital|salbutamol|prednisolone|dexamethasone|hydrocortisone|ceftriaxone|penicillin|clindamycin|cotrimoxazole|fluconazole|mebendazole|albendazole|praziquantel|ivermectin|quinine|fansidar|coartem|ACT)\b/gi
];

function sanitizeResponse(text) {
  let sanitized = text;
  for (const pattern of MEDICINE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[medicine - consult doctor]');
  }
  // Ensure disclaimer is always present
  if (!sanitized.includes('NOT a diagnosis')) {
    sanitized += '\n\n⚠️ This is NOT a diagnosis. Always consult a doctor.';
  }
  return sanitized;
}

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Serve index.html
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('index.html not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  // AI Query endpoint
  if (req.method === 'POST' && req.url === '/api/query') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      const { messages, query } = payload;
      if (!messages && !query) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No messages or query provided' }));
        return;
      }

      const msgArray = messages || [{ role: 'user', content: query }];

      callGroqAPI(msgArray, (err, response) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
          return;
        }
        const sanitized = sanitizeResponse(response);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ response: sanitized }));
      });
    });
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', model: MODEL }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n🏥 RuralHealth AI Server running at http://localhost:${PORT}`);
  console.log(`   Model: ${MODEL}`);
  if (GROQ_API_KEY === 'YOUR_GROQ_API_KEY_HERE') {
    console.log(`\n⚠️  WARNING: Set your GROQ_API_KEY environment variable!`);
    console.log(`   Run: GROQ_API_KEY=your_key_here node server.js\n`);
  }
});
