// api/verify-key.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Simple in-memory cache for rate limits
const rateCache = new Map();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({ error: 'No API key provided' });
  }

  const now = Date.now();
  const minute = Math.floor(now / 60000);
  const cacheKey = `${apiKey}:${minute}`;

  try {
    // Check cache first
    if (rateCache.has(cacheKey)) {
      const count = rateCache.get(cacheKey);
      if (count >= 1000) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          limit: 1000,
          remaining: 0,
          reset: (minute + 1) * 60000
        });
      }
      rateCache.set(cacheKey, count + 1);
      
      return res.status(200).json({
        allowed: true,
        remaining: 1000 - (count + 1),
        limit: 1000
      });
    }

    // Get key from database
    const { data: keyData, error } = await supabase
      .from('api_keys')
      .select('*')
      .eq('key', apiKey)
      .single();

    if (error || !keyData || !keyData.active) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    // Check rate limit
    if (keyData.requests_1m >= keyData.rate_limit) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        limit: keyData.rate_limit,
        remaining: 0,
        reset: now + 60000
      });
    }

    // Update counters
    await supabase
      .from('api_keys')
      .update({
        requests_1m: keyData.requests_1m + 1,
        requests_1h: keyData.requests_1h + 1,
        requests_1d: keyData.requests_1d + 1,
        total_requests: keyData.total_requests + 1,
        last_used: new Date().toISOString()
      })
      .eq('key', apiKey);

    // Update cache
    rateCache.set(cacheKey, keyData.requests_1m + 1);
    setTimeout(() => rateCache.delete(cacheKey), 61000);

    res.status(200).json({
      allowed: true,
      remaining: keyData.rate_limit - (keyData.requests_1m + 1),
      limit: keyData.rate_limit
    });

  } catch (error) {
    console.error('Key verification failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}