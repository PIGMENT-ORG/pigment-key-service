// api/generate-key.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  // Enable CORS for your docs site
  res.setHeader('Access-Control-Allow-Origin', 'https://pigment-org.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { project, email } = req.body;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'];

  try {
    // 1. Generate key via PIGMENT API
    const pigmentRes = await fetch('https://pigment-api.onrender.com/v1/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        email: email || `${project || 'user'}_${Date.now()}@key.pigment` 
      })
    });
    
    if (!pigmentRes.ok) {
      throw new Error('Failed to generate key from PIGMENT');
    }
    
    const { api_key, id } = await pigmentRes.json();

    // 2. Store in Supabase with metadata
    const { data, error } = await supabase
      .from('api_keys')
      .insert([{
        key: api_key,
        key_prefix: api_key.substring(0, 16),
        user_id: id,
        project: project || 'main',
        email: email || null,
        ip: ip,
        user_agent: userAgent,
        rate_limit: 1000,
        requests_1m: 0,
        requests_1h: 0,
        requests_1d: 0,
        created_at: new Date().toISOString(),
        active: true
      }]);

    if (error) throw error;

    // 3. Trigger GitHub notification (fire and forget)
    if (process.env.GITHUB_TOKEN) {
      fetch('https://api.github.com/repos/PIGMENT-ORG/PIGMENT-V6/dispatches', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify({
          event_type: 'new-api-key',
          client_payload: {
            project: project || 'main',
            email: email || 'anonymous',
            ip: ip,
            keyPrefix: api_key.substring(0, 16)
          }
        })
      }).catch(console.error); // Don't wait for this
    }

    // 4. Return the key
    res.status(200).json({
      api_key,
      rate_limit: 1000,
      expires_in: null,
      message: 'Key generated. Rate limit: 1000 requests/minute'
    });

  } catch (error) {
    console.error('Key generation failed:', error);
    res.status(500).json({ error: 'Failed to generate key' });
  }
}